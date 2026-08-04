// Launching and tracking automaton runs. Deno-side only.
//
// Shaped on chat/agent.ts — a Map of live sessions, a per-run event queue, a 20s
// long-poll drain — with one addition: a JSON record per run on disk, which is what
// makes yesterday's runs listable after a restart. The in-memory Map holds only live
// runs; the records outlive the process.
//
// `launchAutomaton` is the SINGLE entry point. The button calls it today; a kanban
// card reaching a column and a cron schedule will call the same function, which is
// why `trigger` is recorded from the first run rather than added later.
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
import { resolveExtensionRefs, resolveSkillRefs } from "./resolve.ts";
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
};

// deno-lint-ignore no-explicit-any
type Session = any;

interface Run {
  scope: ScopeId;
  session: Session;
  unsubscribe: () => void;
  queue: ChatEvent[];
  // Set by stopRun BEFORE it awaits anything. session.prompt()'s promise settles when
  // the abort lands, and its handler would otherwise patch `done`/`failed` over the
  // `stopped` this flag's owner is about to write — or, if it settles first, before it.
  // Either way the last write would win and a stopped run would claim it finished.
  stopped: boolean;
}
const runs = new Map<string, Run>();

export async function writeRunRecord(
  scope: ScopeId,
  record: RunRecord,
): Promise<void> {
  await Deno.writeTextFile(
    runPath(scope, record.id),
    JSON.stringify(record, null, 2),
  );
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
    for (const run of await listRuns(scope)) {
      if (run.status !== "running") continue;
      await patchRunRecord(scope, run.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: "interrupted by shutdown",
      });
    }
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
  },
): Promise<string> {
  const { scope, name, cwd, args } = opts;
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
  try {
    ({ extensionPaths, customTools } = await resolveExtensionRefs(
      scope,
      def.extensions,
    ));
    skillPaths = await resolveSkillRefs(scope, def.skills);
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }

  const modelRuntime = await ensureRuntime();
  const { provider, modelId, thinking } = resolveChatDefaults(
    await resolveScopeConfig(scope),
  );
  const model = modelRuntime.getModel(provider, modelId);
  // No fallback model, unlike chat: a run that quietly used a different model than the
  // scope configured would be discovered long after it finished.
  if (!model) return await fail(`model unavailable: ${provider}/${modelId}`);

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
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: scopeAgentDir(scope),
    noExtensions: true,
    noSkills: true,
    additionalExtensionPaths: extensionPaths,
    additionalSkillPaths: skillPaths,
    additionalPromptTemplatePaths: inheritedPromptDirs(scope),
    systemPrompt: await resolveBasePrompt(scope),
  });
  // createAgentSession only reloads a loader it creates itself, so ours must be
  // reloaded by hand or it yields no extensions at all.
  await resourceLoader.reload();

  const created = await createAgentSession({
    model,
    cwd,
    customTools,
    agentDir: scopeAgentDir(scope),
    resourceLoader,
    // Every run is its own session file — `create`, never `continueRecent`. A run is a
    // job with a beginning, not a conversation to pick back up.
    sessionManager: SessionManager.create(cwd, sessionsDir(scope)),
    modelRuntime,
  });
  const session = created.session;
  const queue: ChatEvent[] = [];
  const unsubscribe = session.subscribe((event: unknown) => {
    const mapped = toFrontendEvent(event);
    if (mapped) queue.push(mapped);
  });
  session.setThinkingLevel(thinking);
  const run: Run = { scope, session, unsubscribe, queue, stopped: false };
  runs.set(id, run);

  await writeRunRecord(scope, {
    id,
    automaton: name,
    status: "running",
    startedAt,
    trigger,
    args,
  });

  // Not awaited: the launch returns as soon as the run is under way, and completion is
  // reported by the record plus a terminal event on the queue. session.prompt() runs
  // whether or not anyone drains, which is what lets an unattended run finish.
  const message = args ? `/${def.prompt} ${args}` : `/${def.prompt}`;
  const finish = async (status: RunStatus, error?: string) => {
    // stopRun already wrote the terminal status; abort is what settled this promise, so
    // its outcome describes the abort rather than the run.
    if (run.stopped) return;
    queue.push(error ? { kind: "error", message: error } : { kind: "done" });
    await patchRunRecord(scope, id, {
      status,
      endedAt: new Date().toISOString(),
      error,
    });
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

// The transcript of a live run, for the frontend to render before any new event
// arrives. A finished run's transcript is read from its session JSONL instead.
export function runHistory(id: string): Item[] {
  return toHistory(runs.get(id)?.session.messages ?? []);
}

export async function stopRun(id: string): Promise<void> {
  const run = runs.get(id);
  if (!run) return;
  // Before the await, not after: abort() settles prompt()'s promise, and finish() must
  // already be able to see that this run was stopped by the time it does.
  run.stopped = true;
  await run.session.abort();
  run.unsubscribe();
  runs.delete(id);
  await patchRunRecord(run.scope, id, {
    status: "stopped",
    endedAt: new Date().toISOString(),
  });
}
