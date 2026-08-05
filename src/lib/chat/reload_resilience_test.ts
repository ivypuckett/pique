// Probes for the edge cases live reload would have to survive before Library can call
// it. reload_test.ts establishes that reload WORKS; these ask whether it stays correct
// when the thing being reloaded is broken, edited rather than added, reloaded twice at
// once, or reloaded out from under a turn that is still streaming.
//
// Written to find out, not to assert a conclusion already reached — where a probe
// records surprising behaviour, the comment says so.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import {
  activeToolNames,
  promptAgent,
  readAgent,
  reloadAgent,
  startAgent,
  stopAgent,
} from "./agent.ts";
import { enableLocal, revokeLocal } from "../extensions/local.ts";
import {
  ensureExtensionDirs,
  livePath,
  pendingPath,
} from "../extensions/paths.ts";
import { writeScopeConfig } from "../scope/config.ts";
import { scopeAgentDir, type ScopeId } from "../scope/paths.ts";

const SCOPE: ScopeId = "ws-1";
const REPLY = "resilience-reply-ok";

// A mock endpoint that can stall, and can answer with a tool call instead of text.
// `received` settles once the model has been called (the turn is provably in flight);
// the gate is open unless a probe closes it with blockModel(), so only the probes that
// need to freeze a turn pay for it. `nextToolCall` makes exactly one response a tool
// call, which is what puts a real toolCall/toolResult pair into the transcript.
let received: Promise<void>;
let markReceived: () => void;
let gate: Promise<void>;
let release: () => void;
let nextToolCall: string | undefined;

function newExchange(): void {
  received = new Promise((r) => (markReceived = r));
  gate = Promise.resolve();
  release = () => {};
  nextToolCall = undefined;
}
newExchange();

// Freeze the model mid-turn until release() is called.
function blockModel(): void {
  gate = new Promise((r) => (release = r));
}

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

// One streamed tool call, then stop. The agent executes the tool and comes back for a
// second completion, which falls through to the text response above.
function sseToolCall(name: string): string {
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
  return chunk({
    index: 0,
    delta: {
      role: "assistant",
      tool_calls: [{
        index: 0,
        id: "call_1",
        type: "function",
        function: { name, arguments: "{}" },
      }],
    },
  }) +
    chunk({ index: 0, delta: {}, finish_reason: "tool_calls" }) +
    "data: [DONE]\n\n";
}

const server = Deno.serve({ port: 0, onListen: () => {} }, async () => {
  markReceived();
  await gate;
  const toolCall = nextToolCall;
  nextToolCall = undefined;
  return new Response(toolCall ? sseToolCall(toolCall) : sse(), {
    headers: { "content-type": "text/event-stream" },
  });
});
server.unref();
const baseUrl = `http://localhost:${(server.addr as Deno.NetAddr).port}/v1`;

async function withTempHome(fn: (cwd: string) => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  const cwd = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  newExchange();
  try {
    await Deno.mkdir(`${dir}/.pi/agent`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.pi/agent/models.json`,
      JSON.stringify({
        providers: {
          mock: {
            baseUrl,
            api: "openai-completions",
            apiKey: "mock",
            models: [{
              id: "mock-model",
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
    release();
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
}

function extensionSource(toolName: string): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: ${JSON.stringify(toolName)},
    label: ${JSON.stringify(toolName)},
    description: "resilience fixture",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: null };
    },
  });
}
`;
}

async function defineAndApprove(
  scope: ScopeId,
  file: string,
  toolName = file,
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, file), extensionSource(toolName));
  await enableLocal(scope, file);
}

// ---------------------------------------------------------------------------
// Probe A: an EDITED extension. reload_test.ts only ever ADDED a file, and a fresh
// path is the case an ESM module cache cannot get wrong. Editing a path that has
// already been imported is the one that can.
// ---------------------------------------------------------------------------
Deno.test("probe A: an edited extension's NEW tool replaces its old one on reload", async () => {
  await withTempHome(async () => {
    await defineAndApprove(SCOPE, "evolving", "tool_v1");
    const chat = await startAgent({ scope: SCOPE });
    try {
      assertEquals(activeToolNames(chat).includes("tool_v1"), true);

      // Same file, different tool name: if the module is served from cache, v1 stays
      // and v2 never appears.
      await Deno.writeTextFile(
        livePath(SCOPE, "evolving"),
        extensionSource("tool_v2"),
      );
      await reloadAgent(chat);

      const tools = activeToolNames(chat);
      assertEquals(
        tools.includes("tool_v2"),
        true,
        "the edited version must load",
      );
      assertEquals(
        tools.includes("tool_v1"),
        false,
        "the old version must be gone",
      );
    } finally {
      stopAgent(chat);
    }
  });
});

// ---------------------------------------------------------------------------
// Probe B: a broken extension. Library can enable a file that does not import — a bad
// edit, a bad approval. The question is blast radius: does reload throw, and does one
// bad file take the healthy extensions down with it?
// ---------------------------------------------------------------------------
Deno.test("probe B: one broken extension does not take the healthy ones with it", async () => {
  await withTempHome(async () => {
    await defineAndApprove(SCOPE, "healthy");
    const chat = await startAgent({ scope: SCOPE });
    try {
      assertEquals(activeToolNames(chat).includes("healthy"), true);

      await ensureExtensionDirs(SCOPE);
      await Deno.writeTextFile(
        livePath(SCOPE, "broken"),
        "this is not valid typescript ((((\n",
      );

      let threw = "";
      try {
        await reloadAgent(chat);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }

      assertEquals(
        activeToolNames(chat).includes("healthy"),
        true,
        `a healthy extension must survive a broken sibling (reload threw: ${threw})`,
      );
      assertEquals(
        threw,
        "",
        "reload must not throw on a broken extension file",
      );

      // Surviving is not the same as being honest about it: reload swallows the failure,
      // so the only thing standing between a user and a silently dead extension is that
      // the loader RECORDS it. It does — `getExtensions().errors` names the file — which
      // is what makes a "failed to load" state reportable in Library rather than
      // guesswork. Read through a loader of the test's own, since agent.ts keeps its own
      // loader private (the same shape prompts/integration_test.ts uses).
      const loader = new DefaultResourceLoader({
        cwd: Deno.cwd(),
        agentDir: scopeAgentDir(SCOPE),
      });
      await loader.reload();
      const errors: Array<{ path: string; error: string }> =
        loader.getExtensions().errors;
      assertEquals(
        errors.some((e) => e.path.includes("broken")),
        true,
        `the failure must be recorded for the UI to surface: ${
          JSON.stringify(errors)
        }`,
      );
    } finally {
      stopAgent(chat);
    }
  });
});

// ---------------------------------------------------------------------------
// Probe C: reload while a turn is streaming. reload() has no idle guard of its own
// (agent-session.js), and the TUI only ever reaches it from an idle prompt. pique's
// Library has no such luck: Enable is clickable while a chat is mid-answer.
// ---------------------------------------------------------------------------
Deno.test("probe C: reloading mid-turn does not corrupt the in-flight turn", async () => {
  await withTempHome(async () => {
    const chat = await startAgent({ scope: SCOPE });
    try {
      blockModel();
      promptAgent(chat, "hello");
      await received; // the turn is provably in flight, parked on the gate

      await defineAndApprove(SCOPE, "midflight_tool");
      let threw = "";
      try {
        await reloadAgent(chat);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      release();

      // The turn still has to finish, and finish with the model's answer rather than
      // an error, or a background Enable can silently break whatever the user was
      // waiting on.
      let done = false;
      let sawError = "";
      let text = "";
      const deadline = Date.now() + 15_000;
      while (!done && Date.now() < deadline) {
        for (const event of await readAgent(chat)) {
          if (event.kind === "error") {
            sawError = event.message;
            done = true;
          }
          if (event.kind === "done") done = true;
          if (event.kind === "text") text += event.delta;
        }
      }
      assertEquals(threw, "", "reload mid-turn must not throw");
      assertEquals(sawError, "", "the in-flight turn must not fail");
      assertEquals(done, true, "the in-flight turn must still complete");
      assertStringIncludes(text, REPLY, "the answer must survive the reload");
    } finally {
      stopAgent(chat);
    }
  });
});

// ---------------------------------------------------------------------------
// Probe D: two reloads at once. Enable and Revoke are two clicks; nothing serialises
// them, and reload() is several awaits deep with no lock.
// ---------------------------------------------------------------------------
Deno.test("probe D: concurrent reloads leave a coherent tool set", async () => {
  await withTempHome(async () => {
    await defineAndApprove(SCOPE, "first");
    const chat = await startAgent({ scope: SCOPE });
    try {
      await defineAndApprove(SCOPE, "second");
      let threw = "";
      try {
        await Promise.all([reloadAgent(chat), reloadAgent(chat)]);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }

      const tools = activeToolNames(chat);
      assertEquals(threw, "", "concurrent reloads must not throw");
      assertEquals(
        tools.includes("first"),
        true,
        "the pre-existing tool must survive",
      );
      assertEquals(
        tools.includes("second"),
        true,
        "the added tool must be present",
      );
      // A duplicated registry would show up as the same name twice.
      assertEquals(
        tools.length,
        new Set(tools).size,
        "the active tool list must not contain duplicates",
      );
    } finally {
      stopAgent(chat);
    }
  });
});

// A tool that parks until a release file appears, so a probe can hold a turn open at
// the exact point where an extension tool is running.
function blockingExtensionSource(
  toolName: string,
  marker: string,
  release: string,
): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: ${JSON.stringify(toolName)},
    label: ${JSON.stringify(toolName)},
    description: "blocking fixture",
    parameters: Type.Object({}),
    async execute() {
      Deno.writeTextFileSync(${JSON.stringify(marker)}, "running");
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          Deno.statSync(${JSON.stringify(release)});
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 10));
        }
      }
      return { content: [{ type: "text", text: "tool-ran" }], details: null };
    },
  });
}
`;
}

async function untilExists(path: string, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await Deno.stat(path);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  throw new Error(`timed out waiting for: ${what}`);
}

// Drain the agent's event queue until the turn ends, collecting what it said.
async function drain(
  chat: string,
): Promise<{ text: string; error: string; done: boolean }> {
  let text = "";
  let error = "";
  let done = false;
  const deadline = Date.now() + 20_000;
  while (!done && Date.now() < deadline) {
    for (const event of await readAgent(chat)) {
      if (event.kind === "text") text += event.delta;
      if (event.kind === "error") {
        error = event.message;
        done = true;
      }
      if (event.kind === "done") done = true;
    }
  }
  return { text, error, done };
}

// ---------------------------------------------------------------------------
// Probe F: reload while an extension's tool is MID-EXECUTION. reload() replaces the
// ExtensionRunner that the running tool was wrapped by; probe C only covered a turn
// parked at the model, which never touches the runner.
// ---------------------------------------------------------------------------
Deno.test("probe F: reloading while an extension tool is running does not break the turn", async () => {
  await withTempHome(async () => {
    const marker = `${await Deno.makeTempDir()}/running`;
    const releaseFile = `${await Deno.makeTempDir()}/release`;
    await ensureExtensionDirs(SCOPE);
    await Deno.writeTextFile(
      livePath(SCOPE, "slow"),
      blockingExtensionSource("slow_tool", marker, releaseFile),
    );

    const chat = await startAgent({ scope: SCOPE });
    try {
      assertEquals(activeToolNames(chat).includes("slow_tool"), true);

      nextToolCall = "slow_tool";
      promptAgent(chat, "use the tool");
      await untilExists(marker, "the extension tool to start executing");

      let threw = "";
      try {
        await reloadAgent(chat);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      await Deno.writeTextFile(releaseFile, "go");

      const { text, error, done } = await drain(chat);
      assertEquals(threw, "", "reload during tool execution must not throw");
      assertEquals(error, "", "the turn must not fail");
      assertEquals(done, true, "the turn must still complete");
      assertStringIncludes(text, REPLY, "the follow-up answer must arrive");
    } finally {
      stopAgent(chat);
    }
  });
});

// ---------------------------------------------------------------------------
// Probe G: the transcript outlives the tool. Once a tool has been CALLED, the
// conversation holds a toolCall/toolResult pair naming it; revoking the extension and
// reloading leaves pi assembling a request whose history mentions a tool that no
// longer exists. This probe covers pique's and pi's side of that only — whether a
// given provider ACCEPTS such a request is a provider question the mock cannot answer.
// ---------------------------------------------------------------------------
Deno.test("probe G: a conversation that already called a since-revoked tool still runs", async () => {
  await withTempHome(async () => {
    await defineAndApprove(SCOPE, "vanishing");
    const chat = await startAgent({ scope: SCOPE });
    try {
      nextToolCall = "vanishing";
      promptAgent(chat, "use the tool");
      const first = await drain(chat);
      assertEquals(first.error, "", "the fixture turn must succeed");
      assertEquals(first.done, true, "the fixture turn must complete");

      await revokeLocal(SCOPE, "vanishing");
      await reloadAgent(chat);
      assertEquals(
        activeToolNames(chat).includes("vanishing"),
        false,
        "precondition: the tool is gone",
      );

      promptAgent(chat, "and again");
      const second = await drain(chat);
      assertEquals(
        second.error,
        "",
        "a turn whose history calls a removed tool must not fail",
      );
      assertEquals(second.done, true, "the later turn must complete");
      assertStringIncludes(second.text, REPLY);
    } finally {
      stopAgent(chat);
    }
  });
});

// ---------------------------------------------------------------------------
// Probe H: reload is not a once-per-session event. A chat left open all day sees one
// per Enable, Revoke and Install, and every one of them re-imports every extension
// module and rebuilds the runner. Repeated reloads must converge, not accumulate.
// ---------------------------------------------------------------------------
Deno.test("probe H: repeated reloads converge on the same tool set", async () => {
  await withTempHome(async () => {
    await defineAndApprove(SCOPE, "steady");
    const chat = await startAgent({ scope: SCOPE });
    try {
      const before = activeToolNames(chat).slice().sort();
      for (let i = 0; i < 25; i++) await reloadAgent(chat);
      const after = activeToolNames(chat).slice().sort();

      assertEquals(after, before, "25 reloads must not change the tool set");
      assertEquals(
        after.length,
        new Set(after).size,
        "repeated reloads must not accumulate duplicates",
      );
      // The session still has to work afterwards, not merely look right.
      promptAgent(chat, "still there?");
      const { error, done } = await drain(chat);
      assertEquals(
        error,
        "",
        "the session must still run a turn after 25 reloads",
      );
      assertEquals(done, true);
    } finally {
      stopAgent(chat);
    }
  });
});

// ---------------------------------------------------------------------------
// Probe E: the lifecycle events an extension sees. reload() emits session_shutdown
// unconditionally, but emits the matching session_start only when the session has TUI
// bindings — which pique never sets. An extension that pairs the two would be shut
// down and never started again.
// ---------------------------------------------------------------------------
Deno.test("probe E: what lifecycle events an extension actually sees across reload", async () => {
  await withTempHome(async () => {
    const log = await Deno.makeTempFile();
    await ensureExtensionDirs(SCOPE);
    await Deno.writeTextFile(
      livePath(SCOPE, "lifecycle"),
      `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  Deno.writeTextFileSync(${JSON.stringify(log)}, "load\\n", { append: true });
  pi.on("session_start", (event) => {
    Deno.writeTextFileSync(${
        JSON.stringify(log)
      }, "start:" + event.reason + "\\n", { append: true });
  });
  pi.on("session_shutdown", (event) => {
    Deno.writeTextFileSync(${
        JSON.stringify(log)
      }, "shutdown:" + event.reason + "\\n", { append: true });
  });
}
`,
    );

    const chat = await startAgent({ scope: SCOPE });
    try {
      await reloadAgent(chat);
      const seen = (await Deno.readTextFile(log)).trim().split("\n");
      // The observed sequence, pinned so a change in it is visible. Two things it says:
      //
      //   * `session_start` NEVER fires — not on reload, and not at startup either.
      //     pique calls no bindExtensions, so pi's `hasBindings` is false and the emit
      //     is skipped on both paths. That is a pre-existing hole, not one reload digs:
      //     an extension whose setup lives in a session_start handler has never run in
      //     pique. Recorded in docs/extensions.md as its own item.
      //   * reload's shutdown is therefore paired with the module's re-execution
      //     (`load`), not with a `start`. For an extension that sets up at module scope
      //     and tears down on shutdown — the shape pi's own docs demonstrate — that
      //     sequence is coherent.
      assertEquals(
        seen,
        ["load", "shutdown:reload", "load"],
        "the lifecycle an extension sees across one reload",
      );
    } finally {
      stopAgent(chat);
      await Deno.remove(log).catch(() => {});
    }
  });
});
