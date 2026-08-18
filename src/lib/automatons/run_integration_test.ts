// End-to-end check of the claim an automaton exists to make: a run loads EXACTLY the
// extensions and skills its file names — not the ones the scope enabled for chat — and
// a run that finishes leaves a readable transcript behind after its session is gone.
//
// Everything below goes through the real launchAutomaton path, with a real pi session
// and real extension modules on disk. Two pieces of scaffolding make that reachable on
// a machine with no model server:
//
//   * a models.json seeded into the temp HOME, which is where ModelRuntime.create()
//     looks — without it run.ts refuses the launch outright ("model unavailable"),
//     because unlike chat it has no fallback model;
//   * a mock `openai-completions` endpoint (below), so a run can actually COMPLETE.
//     Completion is what Group 2 is about: eviction, the JSONL transcript, and the two
//     terminal-status races. None of it is observable from a launch that never returns.
//
// The mock gates its response, so "the run is mid-flight" and "the run has finished"
// are both states the test puts the system into deliberately rather than waits out.
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  activeToolNamesOfRun,
  launchAutomaton,
  listRuns,
  liveRunsOf,
  readRun,
  runHistory,
  type RunRecord,
  stopRun,
} from "./run.ts";
import { dispatchArrival } from "./kanban.ts";
import { approveAutomaton, reviewAutomaton, saveAutomaton } from "./service.ts";
import { sessionsDir } from "./paths.ts";
import {
  board,
  closeAllBoards,
  setCardArrivedHandler,
} from "../kanban/service.ts";
import { writeJson } from "../settings/file.ts";
import { activeToolNames, startAgent, stopAgent } from "../chat/agent.ts";
import { enableLocal } from "../extensions/local.ts";
import { ensureExtensionDirs, pendingPath } from "../extensions/paths.ts";
import { savePrompt } from "../prompts/service.ts";
import { writeScopeConfig } from "../scope/config.ts";
import type { ScopeId } from "../scope/paths.ts";

const SCOPE: ScopeId = "ws-1";
// What the mock model answers with, and what the transcript must therefore contain.
const REPLY = "automaton-reply-ok";

// ---------------------------------------------------------------------------
// The mock model endpoint.
//
// ONE server for the whole file, because chat/agent.ts's ModelRuntime is a process-wide
// singleton: it is created on the first launch and never re-reads models.json, so the
// baseUrl the first test seeds is the one every later test in this file gets. A
// per-test server would bind a fresh port that the cached runtime never learns about.
// (Deno gives each test FILE its own isolate, so this singleton is not shared with the
// rest of the suite — verified.)
// ---------------------------------------------------------------------------

// One request/response exchange, reset per test. `received` settles when the model
// endpoint has actually been called — that is how a test knows a run is mid-flight —
// and `release` is what lets the answer through.
let received: Promise<void>;
let markReceived: () => void;
let gate: Promise<void>;
let release: () => void;

function newExchange(): void {
  received = new Promise((r) => (markReceived = r));
  gate = new Promise((r) => (release = r));
}
newExchange();

function sse(): string {
  const chunk = (choice: unknown) =>
    `data: ${
      JSON.stringify({
        id: "mock-completion",
        object: "chat.completion.chunk",
        created: 0,
        model: "mock-model",
        choices: [choice],
      })
    }\n\n`;
  return chunk({ index: 0, delta: { role: "assistant", content: REPLY } }) +
    chunk({ index: 0, delta: {}, finish_reason: "stop" }) +
    "data: [DONE]\n\n";
}

const server = Deno.serve({ port: 0, onListen: () => {} }, async () => {
  markReceived();
  await gate;
  return new Response(sse(), {
    headers: { "content-type": "text/event-stream" },
  });
});
// Otherwise the listener keeps the test process alive after the last test.
server.unref();
const baseUrl = `http://localhost:${(server.addr as Deno.NetAddr).port}/v1`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function withTempHome(fn: (cwd: string) => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  const cwd = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  newExchange();
  try {
    // The model the scope resolves to, pointed at the mock. Seeded before anything
    // touches the runtime; see the note on the shared server above.
    await Deno.mkdir(`${dir}/.pi/agent`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.pi/agent/models.json`,
      JSON.stringify({
        providers: {
          mock: {
            baseUrl,
            api: "openai-completions",
            apiKey: "mock",
            // Two models on one endpoint. The second exists solely so a test can pin a
            // model that is provably NOT the scope default below.
            models: [{
              id: "mock-model",
              contextWindow: 128000,
              input: ["text"],
            }, {
              id: "other-model",
              contextWindow: 128000,
              input: ["text"],
            }],
          },
        },
      }),
    );
    await writeScopeConfig(SCOPE, {
      chat: { defaultProvider: "mock", defaultModel: "mock-model" },
    });
    await fn(cwd);
  } finally {
    // Never leave the endpoint blocked: a handler still parked on the gate would stall
    // the next test's request behind it.
    release();
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
}

// A real pi extension module — the same shape define_extension writes and a human
// approves, so this exercises the loader rather than a stub.
function extensionSource(name: string): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: ${JSON.stringify(name)},
    label: ${JSON.stringify(name)},
    description: "integration fixture",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: null };
    },
  });
}
`;
}

async function defineAndApprove(scope: ScopeId, name: string): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, name), extensionSource(name));
  await enableLocal(scope, name);
}

// Two extensions enabled in the SAME scope and one automaton naming only the first,
// plus the prompt template it sends. This is the whole fixture Group 1 rests on.
async function setUpAutomaton(): Promise<void> {
  await defineAndApprove(SCOPE, "named_tool");
  await defineAndApprove(SCOPE, "unnamed_tool");
  await savePrompt(SCOPE, "job", { description: "fixture", body: "say ok" });
  await saveAutomaton(SCOPE, "triage", {
    description: "fixture",
    prompt: "job",
    extensions: ["named_tool", "pique:kanban"],
    skills: [],
  });
}

async function recordOf(id: string): Promise<RunRecord> {
  const record = (await listRuns(SCOPE)).find((r) => r.id === id);
  if (!record) throw new Error(`no record for run ${id}`);
  return record;
}

// Poll until `check` holds, or fail. Bounded so a regression that never settles fails
// the test in seconds instead of hanging the suite.
async function until(
  what: string,
  check: () => boolean | Promise<boolean>,
  ms = 15_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out after ${ms}ms waiting for: ${what}`);
}

// The inverse of until(): hold a run's record under observation and fail the MOMENT it
// changes, rather than sampling once at a guessed deadline. "A late writer never
// overwrites this" is only provable over a window — and the sampling has to be
// continuous, because a fixed sleep silently degrades into no assertion at all as soon
// as the machine is slower than the number that was guessed.
async function staysAt(
  id: string,
  expected: RunRecord,
  ms = 3_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const now = await recordOf(id);
    assertEquals(
      now.status,
      expected.status,
      `run ${id} was overwritten ${ms - (deadline - Date.now())}ms in`,
    );
    assertEquals(now.endedAt, expected.endedAt, "endedAt was rewritten");
    await new Promise((r) => setTimeout(r, 20));
  }
}

// The run's DURABLE outcome has settled. Generous, because a real prompt round trip
// happens in between.
async function awaitTerminal(id: string): Promise<RunRecord> {
  await until(
    `run ${id} to reach a terminal status`,
    async () => (await recordOf(id)).status !== "running",
  );
  return await recordOf(id);
}

// …and finish() has also evicted it from the live Map. That is a second, separate step
// — the record is patched first — so anything asserting about the post-run state has to
// wait for it. Tight bound: eviction is in-process and follows the record immediately.
async function awaitFinished(id: string): Promise<RunRecord> {
  const record = await awaitTerminal(id);
  await until(
    `run ${id} to be evicted from the live map`,
    () => activeToolNamesOfRun(id).length === 0,
    5_000,
  );
  return record;
}

// ---------------------------------------------------------------------------
// Group 1 — the capability set is COMPOSED from what the file names, not filtered
// from what the scope already loads.
// ---------------------------------------------------------------------------

// The control for the test below. If this failed, "unnamed_tool is absent from the run"
// would be true for the uninteresting reason that the fixture never enabled it — the
// assertion would pass while proving nothing.
Deno.test("both fixture extensions do reach an ordinary chat agent in the scope", async () => {
  await withTempHome(async () => {
    await setUpAutomaton();
    const chat = await startAgent({ scope: SCOPE });
    try {
      const tools = activeToolNames(chat);
      assertEquals(tools.includes("named_tool"), true);
      assertEquals(tools.includes("unnamed_tool"), true);
    } finally {
      stopAgent(chat);
    }
  });
});

Deno.test("a run loads the extension it names and NOT the one the scope enabled beside it", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    const tools = activeToolNamesOfRun(id);

    assertEquals(
      tools.includes("named_tool"),
      true,
      "the extension the automaton names must load",
    );
    // The whole point: noExtensions makes the loaded set EXACTLY what was named, so an
    // extension enabled in this scope but absent from the file never reaches the run.
    assertEquals(
      tools.includes("unnamed_tool"),
      false,
      "an extension enabled in the scope but not named must NOT load",
    );
    // A `pique:` group is a customTools entry rather than a path, so it travels a
    // different route into the session and needs its own check.
    assertEquals(
      tools.includes("kanban_get_board"),
      true,
      "a named pique: group must contribute its tools",
    );
    // With no `tools:` key the capability set governs extensions and skills only, and
    // pi's builtins are all present — the behaviour of every automaton written before
    // that key existed. Restricting them is opt-in, below.
    assertEquals(
      tools.includes("read"),
      true,
      "pi's builtins must stay available",
    );
    assertEquals(
      tools.includes("bash"),
      true,
      "pi's builtins must stay available",
    );

    // Torn down here rather than left to the gate release below, so this test's run
    // cannot still be finishing while the next one runs.
    await stopRun(id);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — what only a completed run can show.
// ---------------------------------------------------------------------------

// finish() evicts the session, so from that moment the JSONL named by the record is the
// only copy of the transcript. getEntries() returns a discriminated union in which only
// `type: "message"` carries an AgentMessage; handing the raw entries to toHistory yields
// zero items and renders every finished run blank. Nothing but this catches that.
Deno.test("a finished run's transcript is rebuilt from its session JSONL", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    await received;
    release();
    const record = await awaitFinished(id);
    assertEquals(record.status, "done");

    const items = await runHistory(SCOPE, id);
    assertEquals(
      items.some((i) => i.role === "user"),
      true,
      "the expanded prompt template should be in the transcript",
    );
    const reply = items.find((i) => i.role === "assistant");
    if (!reply || reply.role !== "assistant") {
      throw new Error(
        `no assistant item in ${JSON.stringify(items)}`,
      );
    }
    assertStringIncludes(reply.text, REPLY);
  });
});

// ---------------------------------------------------------------------------
// Group 3 — which model a run uses, and where that is recorded.
// ---------------------------------------------------------------------------

// The inherit path: no `model:` in the file, so the run takes the scope's chat default
// — and says so on the record, which is the only place a finished run's model survives.
Deno.test("a run with no model of its own records the scope's default", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    assertEquals((await recordOf(id)).model, "mock/mock-model");

    await stopRun(id);
  });
});

// The pinned path. `other-model` is a second model on the same endpoint and is NOT what
// the scope config names, so a record saying so proves the definition's ref is what
// reached getModel rather than the default coincidentally matching.
Deno.test("a run pins the model its file names, over the scope's default", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();
    await saveAutomaton(SCOPE, "triage", {
      description: "fixture",
      prompt: "job",
      extensions: [],
      skills: [],
      model: "mock/other-model",
    });

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    assertEquals((await recordOf(id)).model, "mock/other-model");

    await stopRun(id);
  });
});

// No fallback, deliberately: a run that quietly used a different model than its file
// names would be discovered long after it finished.
Deno.test("a run naming an unavailable model is refused rather than falling back", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();
    await saveAutomaton(SCOPE, "triage", {
      description: "fixture",
      prompt: "job",
      extensions: [],
      skills: [],
      model: "mock/nosuchmodel",
    });

    let raised = "";
    try {
      await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err);
    }
    assertEquals(raised, "model unavailable: mock/nosuchmodel");

    const [record] = await listRuns(SCOPE);
    assertEquals(record.status, "failed");
    assertEquals(record.error, "model unavailable: mock/nosuchmodel");
  });
});

// Every unit test hand-writes sessionFile onto the record. If the assignment at launch
// regressed to undefined all of them would still pass, and every finished run would
// render blank — runHistory returns [] without it.
Deno.test("a real launch records the session file the run streamed into", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    await received;
    // Recorded at LAUNCH, while the run is still going — that is what makes a run
    // interrupted halfway still have a transcript to point at.
    const running = await recordOf(id);
    assertEquals(running.status, "running");
    assertEquals(typeof running.sessionFile, "string");
    assertStringIncludes(running.sessionFile!, sessionsDir(SCOPE));

    release();
    await awaitFinished(id);
    // pi creates the file on its first append, so it only has to exist by the end.
    assertEquals((await Deno.stat(running.sessionFile!)).isFile, true);
  });
});

// finish() deletes the run from the Map. Left in it, the run would keep a pi session and
// its subscription alive for the life of the process — and stay stoppable. readRun is
// the cheap observable: a live run with an empty queue long-polls for a full 20s, an
// evicted one answers immediately.
Deno.test("a finished run is evicted, so readRun answers at once instead of long-polling", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    await received;
    release();
    await awaitFinished(id);

    const started = Date.now();
    assertEquals(await readRun(id), []);
    const elapsed = Date.now() - started;
    if (elapsed > 5_000) {
      throw new Error(
        `readRun long-polled for ${elapsed}ms — the run was never evicted`,
      );
    }
  });
});

// Critical: a stop arriving after the run already finished must change nothing. It would
// otherwise rewrite `done` into `stopped` (or `failed` into `stopped`, keeping the stale
// error beside it), so the run list would lie about what happened.
//
// Waits for the terminal RECORD only, not for eviction — but be honest about what that
// buys: finish() patches the record and deletes from the Map in the same synchronous
// stretch, and this polls at 20ms, so in practice the stop almost always lands AFTER
// eviction and it is stopRun's `!run` guard doing the work. The `run.stopped` guard
// covers the same call in the narrow window before the delete; both are `return`, so the
// assertion holds either way, but only the post-eviction path is reliably exercised here.
Deno.test("stopping an already-finished run does not rewrite its outcome", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    await received;
    release();
    const finished = await awaitTerminal(id);
    assertEquals(finished.status, "done");

    await stopRun(id);

    const after = await recordOf(id);
    assertEquals(
      after.status,
      "done",
      "a late stop must not rewrite the outcome",
    );
    assertEquals(after.endedAt, finished.endedAt, "nor the time it happened");
    assertEquals(after.error, undefined);
  });
});

// The other half of the same race. Aborting settles prompt(), whose handler then calls
// finish() — without the single-shot latch it would patch `done` over the `stopped`
// that caused it, and a run the user stopped would report success.
Deno.test("stopping a run mid-flight leaves exactly one stopped record", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    const id = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    // The model endpoint has been reached and is parked on the gate, so the run is
    // provably mid-flight rather than merely young.
    await received;
    await stopRun(id);

    const stopped = await recordOf(id);
    assertEquals(stopped.status, "stopped");
    assertEquals(typeof stopped.endedAt, "string");

    // Let the request through: this is what settles prompt() and gives finish() its
    // chance to overwrite the record. An overwrite can land at any point after that, so
    // the record is WATCHED across the window rather than sampled once at its end — a
    // single late sample passes on an unloaded machine and stops testing anything on a
    // slow one, which is how this test previously reported ok with the latch removed.
    release();
    await staysAt(id, stopped);

    const after = await recordOf(id);
    assertEquals(
      after.status,
      "stopped",
      "finish() must not overwrite the stop",
    );
    assertEquals(after.endedAt, stopped.endedAt);
    assertEquals(
      (await listRuns(SCOPE)).length,
      1,
      "a stopped run is one record, not two",
    );
  });
});

// ---------------------------------------------------------------------------
// Group 3 — `tools:`, which withholds pi's builtins.
//
// The claim worth driving through a real session is not that `read` disappears; it is
// that withholding builtins does NOT take the run's own capability set with it. pi
// applies its allowlist to extension tools and customTools as well as builtins, so a
// naive `allowedToolNames: ["read"]` would silently strip everything `extensions:`
// resolved — and the run would do less than its file says while reporting success.
// ---------------------------------------------------------------------------

Deno.test("a run naming tools: keeps exactly those builtins, and all of its extensions", async () => {
  await withTempHome(async (cwd) => {
    await defineAndApprove(SCOPE, "named_tool");
    await savePrompt(SCOPE, "job", { description: "fixture", body: "say ok" });
    await saveAutomaton(SCOPE, "restricted", {
      description: "fixture",
      prompt: "job",
      extensions: ["named_tool", "pique:kanban"],
      skills: [],
      tools: ["read", "grep"],
    });

    const id = await launchAutomaton({ scope: SCOPE, name: "restricted", cwd });
    const tools = activeToolNamesOfRun(id);

    assertEquals(tools.includes("read"), true, "a named builtin stays");
    assertEquals(tools.includes("grep"), true, "a named builtin stays");
    assertEquals(
      tools.includes("bash"),
      false,
      "an unnamed builtin must be withheld",
    );
    assertEquals(tools.includes("write"), false, "and so must the rest");
    assertEquals(tools.includes("edit"), false, "and so must the rest");

    // The whole point of excluding rather than allowlisting.
    assertEquals(
      tools.includes("named_tool"),
      true,
      "the extension the automaton named must survive the restriction",
    );
    assertEquals(
      tools.includes("kanban_get_board"),
      true,
      "and so must a pique: group",
    );

    await stopRun(id);
  });
});

Deno.test("a run with tools: [] gets no builtins at all, only what it named", async () => {
  await withTempHome(async (cwd) => {
    await defineAndApprove(SCOPE, "named_tool");
    await savePrompt(SCOPE, "job", { description: "fixture", body: "say ok" });
    await saveAutomaton(SCOPE, "bare", {
      description: "fixture",
      prompt: "job",
      extensions: ["named_tool"],
      skills: [],
      tools: [],
    });

    const id = await launchAutomaton({ scope: SCOPE, name: "bare", cwd });
    const tools = activeToolNamesOfRun(id);

    for (const builtin of ["read", "bash", "edit", "write", "grep"]) {
      assertEquals(
        tools.includes(builtin),
        false,
        `tools: [] must withhold ${builtin}`,
      );
    }
    assertEquals(
      tools.includes("named_tool"),
      true,
      "an empty tools: is a restriction on builtins, not on the capability set",
    );

    await stopRun(id);
  });
});

Deno.test("a tools: name that is not a builtin refuses the launch", async () => {
  await withTempHome(async (cwd) => {
    await savePrompt(SCOPE, "job", { description: "fixture", body: "say ok" });
    await saveAutomaton(SCOPE, "typo", {
      description: "fixture",
      prompt: "job",
      extensions: [],
      skills: [],
      tools: ["reed"],
    });

    let raised = "";
    try {
      await launchAutomaton({ scope: SCOPE, name: "typo", cwd });
    } catch (err) {
      raised = err instanceof Error ? err.message : String(err);
    }
    assertStringIncludes(raised, "not a pi builtin");

    // And it is recorded as failed rather than leaving nothing behind, the way every
    // other refused launch is.
    const [record] = await listRuns(SCOPE);
    assertEquals(record.status, "failed");
    assertStringIncludes(record.error ?? "", "not a pi builtin");
  });
});

// ---------------------------------------------------------------------------
// Group 4 — the kanban trigger, end to end.
//
// Every layer of the trigger is unit-tested against injected deps; this one proves they
// are CONNECTED. Nothing is stubbed but the model: board.setStatus → the service's
// arrival handler → dispatchArrival → launchAutomaton → a record on disk.
//
// The automaton names a prompt template that does not exist, so the launch is REFUSED —
// which is the point. A refused launch still writes its `failed` record, so the whole
// chain is observable without a model runtime ever being reached.
//
// One seam this cannot cover: desktop.ts is what registers the handler in production and
// a test cannot import it, so the test registers its own. This proves the chain works
// when wired, not that the boot wiring exists.
// ---------------------------------------------------------------------------

Deno.test("a card moved into the watched column fires the automaton", async () => {
  await withTempHome(async (cwd) => {
    // Root has to be IN the layout or the dispatcher declines to fire: the layout is
    // where a triggered run's cwd comes from (targets.ts).
    await writeJson("layout", { root: { id: "root", cwd } });
    await saveAutomaton("root", "worker", {
      description: "",
      prompt: "no-such-template",
      extensions: [],
      skills: [],
      kanban: "Todo",
    });
    // The dispatcher fires only what a human approved (approval.ts), so approval is now
    // part of the chain this drives. Through the real path, over the real bytes.
    const { digest } = await reviewAutomaton("root", "worker");
    await approveAutomaton("root", "worker", digest);
    setCardArrivedHandler((scope, arrival) => {
      void dispatchArrival(scope, arrival);
    });
    try {
      const b = await board("root");
      const statuses = b.getBoard().statuses;
      const backlog = statuses.find((s) => s.name === "Backlog")!;
      const todo = statuses.find((s) => s.name === "Todo")!;
      // Created in a column nothing watches, so only the MOVE below can be what fired.
      const cardId = b.createCard({
        statusId: backlog.id,
        title: "Fix the login bug",
        actor: "human",
      });
      b.setStatus({
        cardId,
        statusId: todo.id,
        reason: "starting",
        actor: "human",
      });

      // The handler is synchronous into a fire-and-forget dispatch, so there is nothing
      // to await — the record appearing IS the completion signal.
      await until(
        "the arrival to reach a run record",
        async () => (await listRuns("root")).length > 0,
      );

      const [record] = await listRuns("root");
      assertEquals(record.automaton, "worker");
      assertEquals(record.trigger, "kanban");
      assertEquals(record.card, cardId);
      assertEquals(record.status, "failed");
      // `$1` is the card id, `$2` its title as one quoted positional.
      assertEquals(record.args, `${cardId} "Fix the login bug"`);
      // Not merely "some refusal": this is the refusal of the definition saved above.
      // Without it a launch that never found the file — the temp HOME not being the one
      // saveAutomaton wrote into — would satisfy every other assertion here.
      assertStringIncludes(record.error ?? "", "prompt template not found");
    } finally {
      // Both are module-level state that would otherwise leak into whatever runs next:
      // the handler fires for every later board, and a cached handle holds a board.db
      // inside a temp HOME this helper is about to delete.
      setCardArrivedHandler(undefined);
      closeAllBoards();
    }
  });
});

// ---------------------------------------------------------------------------
// Group 5 — the two things the kanban queue rests on, against real runs.
//
// Both are observable ONLY here. Every dispatcher test injects its own deps, so the
// queue drains happily in kanban_test.ts with `notifyEnd` deleted from run.ts and with
// `liveRunsOf` counting runs no card started — while in production every queue stops
// draining and every manual run eats a `wip:` slot nothing gives back.
// ---------------------------------------------------------------------------

Deno.test("liveRunsOf reports a live run's card, and only card runs", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    let ended = 0;
    const carded = await launchAutomaton({
      scope: SCOPE,
      name: "triage",
      cwd,
      card: "card-7",
      trigger: "kanban",
      onEnd: () => ended++,
    });
    // The Launch button's shape — same definition, same scope, no card — live at the
    // same moment, so the filter is doing work rather than reading an empty Map.
    const manual = await launchAutomaton({ scope: SCOPE, name: "triage", cwd });
    assertEquals(liveRunsOf(SCOPE, "triage"), ["card-7"]);

    release();
    await awaitFinished(carded);
    await awaitFinished(manual);
    // finish() patches the record, evicts, and only then notifies; the eviction awaited
    // above is not proof the handler ran.
    await until("the card run's end handler to be called", () => ended === 1);
    assertEquals(liveRunsOf(SCOPE, "triage"), []);
  });
});

// The other terminal path. A run the user stops frees its `wip:` slot exactly as a
// finished one does, so it has to drain the queue exactly as a finished one does.
Deno.test("a stopped run reaches its end handler too", async () => {
  await withTempHome(async (cwd) => {
    await setUpAutomaton();

    let ended = 0;
    const id = await launchAutomaton({
      scope: SCOPE,
      name: "triage",
      cwd,
      card: "card-8",
      trigger: "kanban",
      onEnd: () => ended++,
    });
    // Parked on the gate: provably mid-flight rather than merely young.
    await received;
    await stopRun(id);

    assertEquals(ended, 1);
    assertEquals(liveRunsOf(SCOPE, "triage"), []);
  });
});
