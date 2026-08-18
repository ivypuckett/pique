// Launching and tracking automaton runs. Deno-side only.
//
// Shaped on chat/agent.ts — a Map of live sessions, a per-run event queue, a 20s
// long-poll drain — with one addition: a JSON record per run on disk, which is what
// makes yesterday's runs listable after a restart. The in-memory Map holds only live
// runs; the records outlive the process.
//
// `launchAutomaton` is the SINGLE entry point. The button calls it, schedule.ts's cron
// clock calls it, and a kanban card reaching a column will call the same function —
// which is why `trigger` is recorded from the first run rather than added later.
//
// A run cannot outlive the app: quitting mid-run leaves a `running` record describing
// nothing, which reconcileRuns() fixes at startup.
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  type ChatEvent,
  ensureRuntime,
  type Item,
  resolveChatDefaults,
  toFrontendEvent,
  toHistory,
} from "../chat/agent.ts";
import { resolveAutomaton } from "./service.ts";
import { splitModelRef } from "./parse.ts";
import {
  excludedBuiltins,
  resolveExtensionRefs,
  resolveSkillRefs,
} from "./resolve.ts";
import { ensureAutomatonDirs, runPath, runsDir, sessionsDir } from "./paths.ts";
import { inheritedPromptDirs } from "../prompts/service.ts";
import { resolveScopeConfig } from "../scope/config.ts";
import { resolveBasePrompt } from "../scope/prompt.ts";
import {
  assertScopeId,
  ensureScopeDirs,
  scopeAgentDir,
  type ScopeId,
  scopesDir,
} from "../scope/paths.ts";

export type RunStatus = "running" | "done" | "failed" | "stopped";

// A type alias, not an interface, so it crosses the win.bind boundary as JSON.
export type RunRecord = {
  id: string;
  automaton: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
  // "manual" today; "kanban" / "cron" once those triggers exist. Recorded from the
  // first run so the record shape does not change when they land.
  trigger: string;
  args?: string;
  // The card that fired this run, for `trigger: "kanban"`. `trigger` says what KIND of
  // thing fired it; this says which one, which is what makes an old run legible after the
  // board has moved on. Absent for every other trigger.
  card?: string;
  // The model the run actually used, as `provider/model-id`, recorded once it has been
  // resolved — so a finished run says which model produced it rather than leaving the
  // reader to guess from whatever the scope's default happens to be TODAY. Absent on a
  // record for a launch refused before the model was chosen.
  model?: string;
  // The pi session JSONL this run streamed into, recorded at launch. It is what makes
  // a FINISHED run's transcript readable (runHistory): the live session is evicted the
  // moment it ends, so after that the file is the only copy.
  sessionFile?: string;
};

// deno-lint-ignore no-explicit-any
type Session = any;

interface Run {
  scope: ScopeId;
  // Which definition this run is of. Held so the scheduler can ask whether a schedule's
  // previous run is still going without reading every record off disk each minute.
  automaton: string;
  // The card this run is working, when a kanban arrival started it. Held so the
  // dispatcher's two guards — one run per card, at most `wip:` at once — are answered
  // from this Map rather than by reading every record off disk.
  card?: string;
  // Called once, after this run leaves the Map, whatever its terminal status. The kanban
  // dispatcher passes one to drain its queue; nothing else does, which is why this is a
  // per-launch option rather than a module-level listener registry.
  onEnd?: () => void;
  session: Session;
  unsubscribe: () => void;
  queue: ChatEvent[];
  // The single-shot latch on a run's terminal transition, set by whichever of finish()
  // and stopRun() gets there first and never cleared. It is what stops the loser from
  // writing a second terminal status over the winner's — without it, aborting settles
  // prompt()'s promise and its handler patches `done` over the `stopped` that caused
  // it. Both writers set it BEFORE their first await, so neither can interleave.
  stopped: boolean;
}
const runs = new Map<string, Run>();

// Write a record whole or not at all: a temp file in the same dir, then a rename, which
// POSIX guarantees is atomic within a directory. A half-written record would be
// permanently invisible AND unrepairable — listRuns skips what it cannot parse, so
// reconcileRuns would never see it and a poll waiting for a terminal status would never
// finish. listRuns filters to `.json`, so the temp file is never listed even mid-write.
export async function writeRunRecord(
  scope: ScopeId,
  record: RunRecord,
): Promise<void> {
  const path = runPath(scope, record.id);
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(record, null, 2));
  await Deno.rename(tmp, path);
}

// One record, or undefined when there is none. Same posture as patchRunRecord and for
// the same reason: a missing record is ordinary, but a PermissionDenied — or a runPath
// validation throw — is not, and returning undefined for it would hand runHistory a
// silently empty transcript, which is exactly the failure this module keeps eliminating.
async function readRunRecord(
  scope: ScopeId,
  id: string,
): Promise<RunRecord | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(runPath(scope, id))) as RunRecord;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    console.error(`automaton run ${id}: could not read its record:`, err);
    return undefined;
  }
}

// Update one record in place. Callers are the terminal handlers of a detached
// prompt(), so there is no caller to raise to: a missing record is the ordinary case
// (deleted under us) and returns silently, while anything else is logged rather than
// rethrown. resolve.ts and service.ts rethrow non-NotFound because they run under a
// caller that can report it; here rethrowing would only produce an unhandled
// rejection, which reports it worse. Logged, never swallowed.
async function patchRunRecord(
  scope: ScopeId,
  id: string,
  patch: Partial<RunRecord>,
): Promise<void> {
  let current: RunRecord;
  try {
    current = JSON.parse(
      await Deno.readTextFile(runPath(scope, id)),
    ) as RunRecord;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    console.error(`automaton run ${id}: could not read its record:`, err);
    return;
  }
  try {
    await writeRunRecord(scope, { ...current, ...patch });
  } catch (err) {
    console.error(`automaton run ${id}: could not update its record:`, err);
  }
}

// A scope's runs, newest first. A record that does not parse is skipped rather than
// raising: the dir is user-visible, and one bad file must not blank the list.
export async function listRuns(scope: ScopeId): Promise<RunRecord[]> {
  const dir = runsDir(scope);
  const out: RunRecord[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
        out.push(
          JSON.parse(
            await Deno.readTextFile(`${dir}/${entry.name}`),
          ) as RunRecord,
        );
      } catch {
        continue;
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// Startup repair. Every `running` record belongs to a process that no longer exists,
// because runs live in this process's memory. Called once from desktop.ts, AFTER the
// binds are registered (that file's first constraint).
//
// This assumes ONE pique per machine: a second instance starting while the first has a
// live run would mark that run's record failed while it is still going. Records carry no
// owning pid, so there is nothing to tell the two apart — and now that schedules fire
// runs unattended (schedule.ts), a second instance is likelier to land on one.
export async function reconcileRuns(): Promise<void> {
  const scopes: string[] = [];
  try {
    for await (const entry of Deno.readDir(scopesDir())) {
      if (!entry.isDirectory) continue;
      // A dir whose name is not a legal scope id cannot hold runs pique launched, and
      // letting scopeDir() raise on it would abort the whole startup repair. Skipped,
      // the way service.ts's namesIn skips an illegal basename.
      try {
        assertScopeId(entry.name);
      } catch {
        continue;
      }
      scopes.push(entry.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }
  for (const scope of scopes) {
    // Per scope, not around the loop: listRuns rethrows anything that is not NotFound —
    // a `runs/` that is a regular file gives NotADirectory, an unreadable one gives
    // PermissionDenied — and one such scope must not abort the repair for every scope
    // after it. desktop.ts calls this at boot, so an escaping throw is a boot failure.
    try {
      for (const run of await listRuns(scope)) {
        if (run.status !== "running") continue;
        await patchRunRecord(scope, run.id, {
          status: "failed",
          endedAt: new Date().toISOString(),
          error: "interrupted by shutdown",
        });
      }
    } catch (err) {
      console.error(`automaton runs: could not reconcile scope ${scope}:`, err);
    }
  }
}

// A run's end handler, called once the run is out of the Map. Never allowed to throw: it
// belongs to a caller (the kanban dispatcher), and its failure must not become this
// module's problem when the run itself finished cleanly.
function notifyEnd(id: string, run: Run): void {
  try {
    run.onEnd?.();
  } catch (err) {
    console.error(`automaton run ${id}: its end handler failed:`, err);
  }
}

// Launch `name` in `scope` and return the run id. Everything the run can reach —
// model, base prompt, board, working directory — resolves against `scope`, even when
// the definition itself was inherited from an ancestor.
//
// Resolution happens BEFORE the session is created, so a bad reference fails the
// launch with a recorded reason instead of producing a session quietly missing a
// capability its file names.
export async function launchAutomaton(
  opts: {
    scope: ScopeId;
    name: string;
    cwd: string;
    args?: string;
    trigger?: string;
    card?: string;
    onEnd?: () => void;
  },
): Promise<string> {
  const { scope, name, cwd, args, card } = opts;
  const trigger = opts.trigger ?? "manual";
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await ensureScopeDirs(scope);
  await ensureAutomatonDirs(scope);

  // Both halves of reporting a refused launch, and neither is redundant: the throw is
  // what the win.bind handler turns into an immediate error for whoever pressed the
  // button, and the record is the durable row explaining why the run list has an entry
  // that never started. An unattended trigger has no one to throw at, and a human has
  // no reason to go hunting for a record — each path needs its own.
  const fail = async (message: string): Promise<never> => {
    await writeRunRecord(scope, {
      id,
      automaton: name,
      status: "failed",
      startedAt,
      endedAt: new Date().toISOString(),
      error: message,
      trigger,
      args,
      card,
    });
    throw new Error(message);
  };

  const def = await resolveAutomaton(scope, name);
  if (!def) return await fail(`automaton not found: ${name}`);
  if (def.error) return await fail(def.error);

  let extensionPaths: string[];
  let customTools: Awaited<
    ReturnType<typeof resolveExtensionRefs>
  >["customTools"];
  let skillPaths: string[];
  // Which of pi's builtins to withhold. Resolved with the other refs so a `tools:` naming
  // something that is not a builtin refuses the launch here, rather than running
  // unrestricted because the name matched nothing.
  let excludedToolNames: string[];
  try {
    ({ extensionPaths, customTools } = await resolveExtensionRefs(
      scope,
      def.extensions,
    ));
    skillPaths = await resolveSkillRefs(scope, def.skills);
    excludedToolNames = excludedBuiltins(def.tools);
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }

  // The loader is built and checked BEFORE the model runtime is touched, because it
  // needs nothing the runtime provides — only cwd, the scope's dirs and the ref paths
  // resolved just above (which it consumes, hence the order). Two payoffs: a typo'd
  // `prompt:` is refused without spinning up a whole ModelRuntime first, and this whole
  // stretch — the most defect-prone part of a launch — becomes reachable from a unit
  // test with nothing but a temp HOME.
  //
  // reload() is the likeliest thrower in the function: it is where pi actually resolves
  // and IMPORTS a package that resolveExtensionRefs only checked was ENABLED, so a
  // broken source dies here rather than there.
  let resourceLoader: DefaultResourceLoader;
  try {
    // The capability set. `noExtensions` and `noSkills` make the loaded set EXACTLY the
    // additional* paths — nothing from the scope's own agentDir, nothing from packages
    // it enabled for chat. That is the whole point of an automaton. Verified in the SDK:
    // DefaultResourceLoader.reload() takes `noExtensions ? cliEnabledExtensions : merge(...)`,
    // and cliEnabledExtensions derives solely from additionalExtensionPaths, so passing
    // agentDir does NOT re-admit its extensions/ dir or its settings.json packages.
    //
    // These govern extension- and skill-provided capability only. pi's builtins (read,
    // write, edit, bash) are in every session regardless — see docs/extensions.md
    // deferred #1. This is not a sandbox and must not be described as one.
    //
    // noPromptTemplates stays OFF, because that is how `prompt:` resolves: the first
    // message is `/<template> <args>` and pi's own expander does the rest. With it off,
    // pi auto-discovers this scope's OWN agent/prompts itself — so only the ANCESTOR
    // dirs are passed here, exactly as chat/agent.ts does. Adding the scope's own dir
    // would load every one of its templates twice, as a dir alongside pi's per-file
    // entries, which pi's mergePaths cannot dedupe.
    resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: scopeAgentDir(scope),
      noExtensions: true,
      noSkills: true,
      additionalExtensionPaths: extensionPaths,
      additionalSkillPaths: skillPaths,
      additionalPromptTemplatePaths: inheritedPromptDirs(scope),
      systemPrompt: resolveBasePrompt(scope),
    });
    // createAgentSession only reloads a loader it creates itself, so ours must be
    // reloaded by hand or it yields no extensions at all.
    await resourceLoader.reload();
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }

  // The last unchecked reference in the file. pi's expandPromptTemplate matches on
  // `name` and returns the text UNCHANGED when nothing matches, so a typo'd `prompt:`
  // would not fail — it would send the model the literal string `/nosuchthing`. That
  // is the silent-underdelivery failure resolve.ts exists to prevent, so it is
  // checked here on the same terms. It also catches `prompt: "foo bar"`, which
  // parse.ts trims but permits and which would otherwise run template `foo` with
  // `bar` as its argument.
  //
  // Deliberately narrower than pi's own `/` resolution, which also matches extension
  // commands and `skill:` prefixes: `prompt:` names a prompt template (docs), and
  // accepting the others here would make the field mean something the UI's picker
  // cannot show. Checked before createAgentSession so a run that cannot work leaves
  // no session file behind.
  if (!resourceLoader.getPrompts().prompts.some((p) => p.name === def.prompt)) {
    return await fail(
      `prompt template not found: ${JSON.stringify(def.prompt)}`,
    );
  }

  // The session, and the `running` record that makes it visible, in ONE try: nothing
  // enters the Map until that record is durable. If the write threw with the run
  // already registered, the throw would escape with a live subscribed session in the
  // Map that nothing could ever evict — prompt() was never called, so finish() never
  // runs, and with no record there is no UI row to stop it. A permanent session leak is
  // worse than a lost row, so teardown here is complete rather than best-effort.
  //
  // Every failure inside is a bare throw handled by the single catch below, never a
  // direct fail(): fail() throws, so calling it inside its own try would run it twice
  // and write the record twice.
  let session: Session;
  let queue: ChatEvent[];
  let unsubscribe: (() => void) | undefined;
  try {
    const modelRuntime = await ensureRuntime();
    const defaults = resolveChatDefaults(await resolveScopeConfig(scope));
    // The definition's `model:` wins over the scope's chat default; with no `model:`
    // the run keeps inheriting, which is what every automaton did before the key
    // existed. The thinking level is not per-automaton, so it always comes from the
    // scope (docs/automatons.md deferred #4).
    const { provider, modelId } = def.model
      ? splitModelRef(def.model)
      : { provider: defaults.provider, modelId: defaults.modelId };
    const thinking = defaults.thinking;
    const model = modelRuntime.getModel(provider, modelId);
    // No fallback model, unlike chat: a run that quietly used a different model than
    // the scope configured would be discovered long after it finished.
    if (!model) throw new Error(`model unavailable: ${provider}/${modelId}`);

    const created = await createAgentSession({
      model,
      cwd,
      customTools,
      agentDir: scopeAgentDir(scope),
      resourceLoader,
      // Every run is its own session file — `create`, never `continueRecent`. A run is
      // a job with a beginning, not a conversation to pick back up.
      sessionManager: SessionManager.create(cwd, sessionsDir(scope)),
      modelRuntime,
      // pi's denylist (its `excludedToolNames`, under createAgentSession's name for it).
      // Empty for an automaton with no `tools:` key, which is pi's own default of every
      // builtin present. Extension tools and `pique:` groups are never in this list —
      // `extensions:` is what governs those, and the SDK's sibling `tools:` allowlist
      // would have filtered them too.
      excludeTools: excludedToolNames,
    });
    session = created.session;
    // Excluding the un-named builtins is only half of it. pi's default ACTIVE set is
    // [read, bash, edit, write] — `grep`, `find` and `ls` are registered but inactive —
    // so an automaton naming `grep` would otherwise exclude the others and still not get
    // it, a file that reads like a capability and delivers nothing. The SDK's own
    // `tools:` option would activate them, but it is an allowlist that filters extension
    // tools and customTools too, which is exactly what must not happen here. So the named
    // builtins are activated directly, on top of whatever the capability set contributed.
    if (def.tools !== undefined) {
      session.setActiveToolsByName([
        ...new Set([...session.getActiveToolNames(), ...def.tools]),
      ]);
    }
    queue = [];
    unsubscribe = session.subscribe((event: unknown) => {
      const mapped = toFrontendEvent(event);
      if (mapped) queue.push(mapped);
    });
    session.setThinkingLevel(thinking);

    await writeRunRecord(scope, {
      id,
      automaton: name,
      status: "running",
      startedAt,
      trigger,
      args,
      card,
      model: `${provider}/${modelId}`,
      sessionFile: session.sessionFile,
    });
  } catch (err) {
    // A session created before a later step threw would otherwise leak: nothing else
    // holds it, because it never reached the Map.
    try {
      unsubscribe?.();
      session?.dispose();
    } catch { /* tearing down a half-built session is best-effort */ }
    return await fail(err instanceof Error ? err.message : String(err));
  }

  // Optional only so the catch above can tear down a subscription made before a later
  // step threw; reaching here means the try completed and it is set.
  const run: Run = {
    scope,
    automaton: name,
    card,
    onEnd: opts.onEnd,
    session,
    unsubscribe: unsubscribe!,
    queue,
    stopped: false,
  };
  runs.set(id, run);

  // Not awaited: the launch returns as soon as the run is under way, and completion is
  // reported by the record plus a terminal event on the queue. session.prompt() runs
  // whether or not anyone drains, which is what lets an unattended run finish.
  const message = args ? `/${def.prompt} ${args}` : `/${def.prompt}`;
  const finish = async (status: RunStatus, error?: string) => {
    // stopRun already wrote the terminal status; abort is what settled this promise, so
    // its outcome describes the abort rather than the run.
    if (run.stopped) return;
    run.stopped = true;
    run.queue.push(
      error ? { kind: "error", message: error } : { kind: "done" },
    );
    await patchRunRecord(scope, id, {
      status,
      endedAt: new Date().toISOString(),
      error,
    });
    // Eviction, and it is not merely hygiene. A finished run left in the Map keeps a pi
    // session and a subscription alive for the life of the process, keeps appending
    // undrained events to a queue nobody reads — the normal case for an unattended run
    // — and stays STOPPABLE, so a later stopRun would rewrite `done` into `stopped`, or
    // `failed` into `stopped` while leaving the stale `error` beside it.
    //
    // The cost is that events queued since the frontend's last drain are dropped. That
    // is the right trade: the record has already gone non-`running`, which is the UI's
    // cue to call runHistory and re-render the whole transcript from the JSONL.
    runs.delete(id);
    run.unsubscribe();
    try {
      run.session.dispose();
    } catch (err) {
      console.error(`automaton run ${id}: could not dispose its session:`, err);
    }
    notifyEnd(id, run);
  };
  session
    .prompt(message)
    .then(async () => {
      const errorMessage = session.agent?.state?.errorMessage;
      await (errorMessage
        ? finish("failed", String(errorMessage))
        : finish("done"));
    })
    .catch(async (err: unknown) => {
      await finish("failed", err instanceof Error ? err.message : String(err));
    });

  return id;
}

// Long-poll drain, identical in shape to chat's readAgent: queued events, or [] after
// ~20s so the frontend re-polls. An unknown id (a finished run) drains as [].
export async function readRun(id: string): Promise<ChatEvent[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const queue = runs.get(id)?.queue;
    if (!queue) return [];
    if (queue.length) return queue.splice(0, queue.length);
    await new Promise((r) => setTimeout(r, 15));
  }
  return [];
}

// A run's transcript, live or finished, which is why it needs the scope: a finished run
// is gone from the Map (finish() evicts it) and its only remaining copy is the session
// JSONL named by its record. pi appends that file as the run happens, so it is complete
// the moment prompt() resolves — the two sources agree and the caller need not know
// which one answered.
export async function runHistory(scope: ScopeId, id: string): Promise<Item[]> {
  const live = runs.get(id);
  if (live) return toHistory(live.session.messages ?? []);

  const record = await readRunRecord(scope, id);
  if (!record?.sessionFile) return [];
  try {
    // getEntries() is a union of entry types, not messages: thinking-level changes,
    // model changes, compaction and branch summaries all live in the same stream. Only
    // `message` entries carry the AgentMessage that toHistory consumes.
    const entries = SessionManager.open(record.sessionFile).getEntries();
    return toHistory(
      entries
        .filter((e) => e.type === "message")
        // deno-lint-ignore no-explicit-any
        .map((e) => (e as any).message),
    );
  } catch (err) {
    // A run whose session file was deleted or is unreadable still has a record and a
    // row in the UI; an empty transcript is a better answer there than a raised error.
    console.error(`automaton run ${id}: could not read its transcript:`, err);
    return [];
  }
}

// Names of the tools this run can actually call — the counterpart of chat's
// activeToolNames, and the only way to observe what the capability set actually
// composed. Live runs only: finish() evicts the session, and the tool set is not
// something the record or the JSONL preserves.
export function activeToolNamesOfRun(id: string): string[] {
  return runs.get(id)?.session.getActiveToolNames() ?? [];
}

// Is a run of this definition still going in this scope? The scheduler's re-entrancy
// check (schedule.ts). Answered from the live Map rather than from the records: the Map
// is what "still going" means — a `running` record can also be one this process has
// never seen, which reconcileRuns has not repaired yet.
export function isAutomatonRunning(scope: ScopeId, name: string): boolean {
  for (const run of runs.values()) {
    if (run.scope === scope && run.automaton === name) return true;
  }
  return false;
}

// The live CARD runs of this definition in this scope, as the cards they are working.
// Its LENGTH is the `wip:` count and its MEMBERSHIP is the per-card guard — the kanban
// dispatcher needs both, and asking once keeps them consistent with each other. Same Map,
// and the same reasoning, as isAutomatonRunning above.
//
// A run no card started — the Launch button, a `cron:` — is deliberately NOT counted.
// `wip:` holds card fires only (docs/automatons.md), and the mechanical reason is that
// only a card fire carries the dispatcher's onEnd: a manual run occupying a slot would
// free it, on ending, with nothing to notice, leaving cards queued behind a limit that
// is no longer reached.
export function liveRunsOf(scope: ScopeId, name: string): string[] {
  const cards: string[] = [];
  for (const run of runs.values()) {
    if (
      run.scope === scope && run.automaton === name && run.card !== undefined
    ) {
      cards.push(run.card);
    }
  }
  return cards;
}

export async function stopRun(id: string): Promise<void> {
  const run = runs.get(id);
  // `stopped` already set means finish() or an earlier stopRun owns the outcome.
  if (!run || run.stopped) return;
  // The durable outcome is committed BEFORE the unbounded wait below. session.abort()
  // awaits waitForIdle(), which a tool call that never settles never resolves — and if
  // the teardown lived after it, the run would keep its `running` record forever while
  // `stopped` permanently suppressed finish() from writing any terminal status. That is
  // unrepairable short of a restart. Ordered this way, abort is the last thing and its
  // hanging costs only the session's memory.
  run.stopped = true;
  runs.delete(id);
  run.unsubscribe();
  notifyEnd(id, run);
  await patchRunRecord(run.scope, id, {
    status: "stopped",
    endedAt: new Date().toISOString(),
  });
  try {
    await run.session.abort();
  } finally {
    try {
      run.session.dispose();
    } catch (err) {
      console.error(`automaton run ${id}: could not dispose its session:`, err);
    }
  }
}
