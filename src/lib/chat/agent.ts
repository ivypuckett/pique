// Deno-side pi agent wrapper. Runs in the desktop process only.
// `toFrontendEvent` is the pure, JSON-safe projection of pi's SDK events that
// crosses the win.bind boundary — keep its output plain JSON (see bindings.ts).

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
export type ModelInfo = {
  provider: string;
  id: string;
  name: string;
  current: boolean;
};
// JSON-safe projection of pi's SlashCommandInfo for the chat `/` menu. Mirrors the
// three sources pi's TUI lists (extension commands, prompt templates, skills); the
// `name` is the token typed after `/`, so skills already carry their `skill:` prefix.
// `argumentHint` is what a prompt template's `argument-hint` frontmatter declares — the
// only one of the three sources that has one.
export type CommandInfo = {
  name: string;
  description: string;
  source: "extension" | "prompt" | "skill" | "pique";
  argumentHint?: string;
};

// What one `/reload` did, for the line the chat prints afterwards. `failed` is the
// reason the summary exists at all: pi's reload swallows a module that will not import
// (reload_resilience_test.ts probe B), so without reporting it here a broken extension
// is indistinguishable from one that was never enabled.
export type ReloadSummary = {
  added: string[];
  removed: string[];
  failed: Array<{ name: string; error: string }>;
  // Whether SYSTEM.md or APPEND_SYSTEM.md changed under this conversation and was
  // applied. The comparison is against the text the session last read rather than across
  // the reload, because the edit happened before `/reload` was ever typed; and it is
  // those files rather than the assembled prompt, which also moves when the tool set
  // does.
  promptChanged?: boolean;
  // The default model, when this conversation is not running it and a new chat would
  // be. Reload reports it and does not apply it: a conversation does not get
  // its model swapped underneath it. Absent unless the two genuinely differ.
  modelDefault?: { provider: string; id: string };
};

// One rendered line of the transcript. The streaming path builds these from ChatEvents
// (store.ts's `apply`) and a resumed conversation rebuilds them from pi's stored
// messages (`historyOf`) — the two must agree, which is why the type lives here with
// ChatEvent rather than in the frontend store.
export type Item =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "thinking"; text: string }
  // pique speaking, not the model: what a `/reload` did. Written by the store and never
  // by `historyOf`, so it is deliberately not part of the conversation — resuming the
  // session brings back the messages, not the notices.
  | { role: "notice"; text: string }
  | {
    role: "tool";
    id: string;
    name: string;
    args: string;
    result: string;
    isError: boolean;
    done: boolean;
  };

export type ChatEvent =
  | { kind: "text"; delta: string }
  | { kind: "thinking"; delta: string }
  | { kind: "tool_start"; id: string; name: string; args: string }
  // A partial result from a tool still running (pi's onUpdate), replacing whatever the
  // last one showed; the call stays open until its tool_end.
  | { kind: "tool_update"; id: string; result: string }
  | {
    kind: "tool_end";
    id: string;
    name: string;
    result: string;
    isError: boolean;
  }
  | { kind: "done" }
  | { kind: "error"; message: string };

// deno-lint-ignore no-explicit-any
function preview(value: any): string {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return s.length > 2000 ? s.slice(0, 2000) + "…" : s;
}

// deno-lint-ignore no-explicit-any
export function toFrontendEvent(event: any): ChatEvent | null {
  switch (event?.type) {
    case "message_update": {
      const ev = event.assistantMessageEvent;
      if (ev?.type === "text_delta") return { kind: "text", delta: ev.delta };
      if (ev?.type === "thinking_delta") {
        return { kind: "thinking", delta: ev.delta };
      }
      return null;
    }
    case "tool_execution_start":
      return {
        kind: "tool_start",
        id: event.toolCallId,
        name: event.toolName,
        args: preview(event.args),
      };
    case "tool_execution_update":
      // Unlike tool_execution_end's result, which is previewed whole, only the text
      // blocks survive here: a partial result is shown to a human mid-run, and the
      // AgentToolResult envelope around it is noise.
      return {
        kind: "tool_update",
        id: event.toolCallId,
        result: preview(textOf(event.partialResult?.content)),
      };
    case "tool_execution_end":
      return {
        kind: "tool_end",
        id: event.toolCallId,
        name: event.toolName,
        result: preview(event.result),
        isError: Boolean(event.isError),
      };
    default:
      return null;
  }
}

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { listAvailableModels } from "./available.ts";
import { resolveModuleDir } from "../settings/file.ts";
import { moduleAuthoringTools } from "../modules/agent-tools.ts";
import { readPromptFiles } from "../prompts/system.ts";
import { agentDir, piqueDir, viewSessionsDir } from "../paths.ts";

// deno-lint-ignore no-explicit-any
type Session = any;

// The startup model when nothing is persisted, or when the persisted model is
// unavailable in the runtime. Was the hardcoded M1 pin; now only the fallback.
const FALLBACK_PROVIDER = "lmstudio";
const FALLBACK_MODEL = "google/gemma-4-e4b";

// Pure projection of pi's settings.json (in the agent dir) → the agent's startup model +
// thinking. pi keeps them there itself: a session's setModel and setThinkingLevel save
// the pick as the new default, so the next conversation starts on it. `config` is
// whatever readAgentSettings returned: possibly null, or
// holding non-string values, so every field is guarded.
export function resolveChatDefaults(
  config: unknown,
): { provider: string; modelId: string; thinking: ThinkingLevel } {
  const chat = (config ?? {}) as Record<string, unknown>;
  const str = (
    v: unknown,
    fallback: string,
  ): string => (typeof v === "string" ? v : fallback);
  return {
    provider: str(chat.defaultProvider, FALLBACK_PROVIDER),
    modelId: str(chat.defaultModel, FALLBACK_MODEL),
    thinking: str(chat.defaultThinkingLevel, "off") as ThinkingLevel,
  };
}

// One live chat agent per open Chat module. Was a single global singleton; now
// keyed by a spawn id (mirroring the terminal's per-session model) so each module
// runs its own conversation in its own working directory. The ModelRuntime is the
// one shared, lazily-created resource.
interface Agent {
  session: Session;
  unsubscribe: () => void;
  queue: ChatEvent[];
  // Held so prompt templates can be re-read without restarting the conversation
  // (reloadPrompts, below).
  // deno-lint-ignore no-explicit-any
  resourceLoader: any;
  // SYSTEM.md and APPEND_SYSTEM.md as this conversation last read them, so a reload can
  // tell whether either moved under it. Updated by every reload.
  promptFiles: string;
}
const agents = new Map<string, Agent>();
let nextId = 1;
// Typed, not `any`: this was `any` once, and a call to a reloadConfig() that pi does
// not have type-checked cleanly and threw on every custom-endpoint save instead.
let runtime: ModelRuntime | undefined;

// The single shared ModelRuntime, created lazily. Exported so provider
// management (providers.ts) mutates the same runtime the chat agents stream
// from — auth/models changes there take effect without a restart. Handed the agent
// dir's two files explicitly rather than left to find pi's own dir.
export async function ensureRuntime() {
  if (!runtime) {
    runtime = await ModelRuntime.create({
      authPath: `${agentDir()}/auth.json`,
      modelsPath: `${agentDir()}/models.json`,
    });
  }
  return runtime;
}

// Drop the runtime so the next caller re-reads auth.json and models.json — after an
// import has replaced them underneath it. Conversations already running keep the one
// they started with.
export function resetRuntime(): void {
  runtime = undefined;
}

// pi's settings.json in the agent dir, read rather than written: pi writes it itself.
// Missing or corrupt → null, and resolveChatDefaults falls back.
async function readAgentSettings(): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(`${agentDir()}/settings.json`));
  } catch {
    return null;
  }
}

// Start an agent and return its id. `workspace` and `view` name the Chat module it
// belongs to, and decide one thing only: which conversation this is. By default the
// agent picks that conversation back up where it was left; `fresh` starts a new one.
// Everything else — tools, templates, skills, prompt files — is whatever pi finds in its
// agent dir and in `cwd`.
export async function startAgent(
  opts: {
    cwd?: string;
    workspace?: string;
    view?: string;
    fresh?: boolean;
  } = {},
): Promise<string> {
  const modelRuntime = await ensureRuntime();
  // Startup model/thinking come from the chat defaults; fall back to the consts when
  // unset or when the configured model isn't available.
  const { provider, modelId, thinking } = resolveChatDefaults(
    await readAgentSettings(),
  );
  const cwd = resolveModuleDir(opts.cwd);
  // The view owns the conversation, so it owns the directory the session files live
  // in. A caller that names no view — the integration tests, which only care about
  // tools — shares one thread in pique's sessions dir.
  const sessionDir = opts.workspace && opts.view
    ? viewSessionsDir(opts.workspace, opts.view)
    : `${piqueDir()}/sessions`;
  const model = modelRuntime.getModel(provider, modelId) ??
    modelRuntime.getModel(FALLBACK_PROVIDER, FALLBACK_MODEL);
  // The one tool compiled into pique. Tools from extensions don't appear here — pi
  // loads those itself, below.
  const customTools = moduleAuthoringTools();

  // Built here rather than left to createAgentSession so it can be held: reloadPrompts
  // and reloadAgent's error report both read it back.
  const dir = agentDir();
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: dir });
  // createAgentSession only reloads a loader it creates itself, so ours must be
  // reloaded by hand or it yields no extensions at all.
  await resourceLoader.reload();

  const created = await createAgentSession({
    model,
    cwd,
    customTools,
    // The agent dir (paths.ts). The sessionManager below
    // is given its dir explicitly rather than deriving it here, so conversations stay
    // pique's.
    agentDir: dir,
    resourceLoader,
    // The conversation is written to ~/.pique/sessions/<workspace>/<view> as pi JSONL,
    // appended as it happens, so quitting mid-stream still leaves everything up to that
    // point on disk. continueRecent reopens the newest session recorded for THIS cwd — passing
    // an explicit sessionDir is what makes it filter by cwd rather than take the newest
    // file outright — and pi replays its messages into the agent's context. `fresh`
    // is the deliberate reset: a new file, an empty transcript, the old one kept.
    sessionManager: opts.fresh
      ? SessionManager.create(cwd, sessionDir)
      : SessionManager.continueRecent(cwd, sessionDir),
    modelRuntime,
  });
  const session = created.session;
  const queue: ChatEvent[] = [];
  const unsubscribe = session.subscribe((event: unknown) => {
    const mapped = toFrontendEvent(event);
    if (mapped) queue.push(mapped);
  });
  session.setThinkingLevel(thinking);
  const id = `chat-${nextId++}`;
  agents.set(id, {
    session,
    unsubscribe,
    queue,
    resourceLoader,
    promptFiles: readPromptFiles(),
  });
  return id;
}

// User and toolResult content is either a bare string or a block array. Images have no
// Item to live in, so only text blocks survive the projection.
// deno-lint-ignore no-explicit-any
function textOf(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text").map((b) => b.text).join("");
}

// The pure, JSON-safe projection of pi's stored messages into the transcript, the
// counterpart of toFrontendEvent for a conversation that was resumed rather than
// streamed. pi has already restored these messages into the agent, so this only
// reshapes them into the Items the streaming path produces.
//
// Roles with no Item counterpart (bashExecution, custom, compaction and branch
// summaries) are dropped: they are pi context, not chat bubbles.
// deno-lint-ignore no-explicit-any
export function toHistory(messages: any[]): Item[] {
  const items: Item[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({ role: "user", text: textOf(message.content) });
    } else if (message.role === "assistant") {
      // deno-lint-ignore no-explicit-any
      for (const block of (message.content ?? []) as any[]) {
        if (block.type === "text") {
          items.push({ role: "assistant", text: block.text });
        } else if (block.type === "thinking") {
          items.push({ role: "thinking", text: block.thinking });
        } else if (block.type === "toolCall") {
          items.push({
            role: "tool",
            id: block.id,
            name: block.name,
            args: preview(block.arguments),
            result: "",
            isError: false,
            done: false,
          });
        }
      }
    } else if (message.role === "toolResult") {
      // The call was pushed by the assistant message before it; a tool still running when
      // the app closed simply has no result, and stays `done: false` the way it renders live.
      const call = items.find((i) =>
        i.role === "tool" && i.id === message.toolCallId
      );
      if (call?.role === "tool") {
        call.result = preview(textOf(message.content));
        call.isError = Boolean(message.isError);
        call.done = true;
      }
    }
  }
  return items;
}

// The transcript of a resumed conversation, for the frontend to render before any new
// event arrives. An unknown id (agent already stopped) has no transcript.
export function historyOf(id: string): Item[] {
  return toHistory(agents.get(id)?.session.messages ?? []);
}

export function promptAgent(id: string, text: string): void {
  const agent = agents.get(id);
  if (!agent) throw new Error("chat agent not started");
  const { session, queue } = agent;
  // Do not await: let streaming flow through readAgent. Completion/failure is
  // reported by pushing a terminal event onto the queue.
  session
    .prompt(text)
    .then(() => {
      queue.push(
        session.agent?.state?.errorMessage
          ? { kind: "error", message: String(session.agent.state.errorMessage) }
          : { kind: "done" },
      );
    })
    .catch((err: unknown) => {
      queue.push({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

// Long-poll drain: return queued events, or [] after ~20s so the frontend re-polls.
// An unknown id (agent already stopped) drains as [].
export async function readAgent(id: string): Promise<ChatEvent[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const queue = agents.get(id)?.queue;
    if (!queue) return [];
    if (queue.length) return queue.splice(0, queue.length);
    await new Promise((r) => setTimeout(r, 15));
  }
  return [];
}

export async function abortAgent(id: string): Promise<void> {
  await agents.get(id)?.session.abort();
}

// Tear down one agent on module unmount, freeing its subscription.
export function stopAgent(id: string): void {
  const agent = agents.get(id);
  if (!agent) return;
  agent.unsubscribe();
  agents.delete(id);
}

export async function listModels(id: string): Promise<ModelInfo[]> {
  const agent = agents.get(id);
  if (!runtime || !agent) return [];
  const current = agent.session.model;
  // One provider at a time, so a provider that cannot resolve its credentials — an
  // expired AWS SSO session, a stopped LM Studio — costs the picker its own models
  // and not everyone else's. See available.ts.
  return (await listAvailableModels(runtime)).map((m) => ({
    ...m,
    current: m.provider === current?.provider && m.id === current?.id,
  }));
}

export async function setModel(
  id: string,
  provider: string,
  modelId: string,
): Promise<void> {
  const agent = agents.get(id);
  if (!runtime || !agent) return;
  const model = runtime.getModel(provider, modelId);
  if (model) await agent.session.setModel(model);
}

export function setThinkingLevel(id: string, level: ThinkingLevel): void {
  agents.get(id)?.session.setThinkingLevel(level);
}

// The level this agent is running at — what the picker shows when it opens.
export function thinkingLevelOf(id: string): ThinkingLevel {
  return agents.get(id)?.session.thinkingLevel ?? "off";
}

// Names of the tools this agent can actually call: pi's builtins, pique's compiled-in
// tool, and every tool registered by an extension pi loaded.
export function activeToolNames(id: string): string[] {
  return agents.get(id)?.session.getActiveToolNames() ?? [];
}

// The prompt this agent actually runs with: pi's own preamble or the SYSTEM.md that
// replaced it, plus what pi appends itself (APPEND_SYSTEM.md, project context, skills,
// cwd). Reassembled by every reload, so this tracks an edited SYSTEM.md rather than
// reporting what the session started with (base_prompt_integration_test.ts).
export function systemPromptOf(id: string): string {
  return agents.get(id)?.session.systemPrompt ?? "";
}

// Re-read the resource loader so prompt templates saved in the Library become invocable in a conversation that is already running. Templates are read
// from the loader on every prompt(), so refreshing the loader is enough and the
// transcript survives. This does NOT rebuild the system prompt — pi only does that when
// its own reload() runs — so the agent's recorded promptFiles stay accurate.
export async function reloadPrompts(id: string): Promise<void> {
  await agents.get(id)?.resourceLoader.reload();
}

// Re-read everything the session loaded at startup — extensions and SYSTEM.md included
// — so a change made in the Library or on disk reaches a conversation that is already
// running. pi's own `/reload` is a TUI action, but the flow behind it is `session.reload()`,
// which rebuilds the extension runner AND the system prompt from a re-read loader, and
// hands the fresh tools to the active set. The messages are untouched, so the transcript
// and the model's context both survive (reload_test.ts).
//
// What it still does NOT do: the model default is resolved in startAgent and is only
// reported here, never applied — a conversation does not get its model swapped
// underneath it; and pi skips the extensions' own `session_start` event because pique
// binds no TUI context, so an extension doing its setup in that handler rather than at
// module scope will not have run.
export async function reloadAgent(id: string): Promise<ReloadSummary> {
  const agent = agents.get(id);
  if (!agent) return { added: [], removed: [], failed: [] };
  const before = new Set<string>(agent.session.getActiveToolNames());
  const promptBefore = agent.promptFiles;
  await agent.session.reload();
  const after: string[] = agent.session.getActiveToolNames();
  const afterSet = new Set(after);
  // Read again beside the reload, so the record tracks what the conversation now runs.
  agent.promptFiles = readPromptFiles();
  // The same loader instance the session holds, so this reads the errors from the
  // reload that just happened rather than a stale scan.
  const errors: Array<{ path: string; error: string }> =
    agent.resourceLoader.getExtensions().errors ?? [];
  return {
    added: after.filter((name) => !before.has(name)),
    removed: [...before].filter((name) => !afterSet.has(name)),
    failed: errors.map((e) => ({
      name: e.path.split("/").pop()?.replace(/\.[jt]s$/, "") ?? e.path,
      error: e.error,
    })),
    promptChanged: agent.promptFiles !== promptBefore,
    modelDefault: await pendingModelDefault(agent),
  };
}

// The default model when this conversation is not running it — the case where someone
// changed the default from another view, or edited the config on disk. Undefined unless
// a new chat would genuinely come up on a different model: a default
// that is merely unavailable resolves to the same fallback this session already took, and
// nagging about a model no new chat would reach either would be noise.
async function pendingModelDefault(
  agent: Agent,
): Promise<{ provider: string; id: string } | undefined> {
  const live = agent.session.model;
  if (!live || !runtime) return undefined;
  const { provider, modelId } = resolveChatDefaults(await readAgentSettings());
  if (provider === live.provider && modelId === live.id) return undefined;
  return runtime.getModel(provider, modelId)
    ? { provider, id: modelId }
    : undefined;
}

// The `/` menu list: the same three sources pi's TUI concatenates in getCommands —
// extension commands, file-based prompt templates, and skills (prefixed `skill:`).
// pi's own builtins (/model, /settings, …) are TUI actions pique covers in its own
// UI, so they're omitted. session.prompt() already expands/runs all three, so the
// menu only helps compose the text — no execution logic lives here.
export function listCommands(id: string): CommandInfo[] {
  const session = agents.get(id)?.session;
  if (!session) return [];
  // pique's own, and the only entries here that pi does not expand: `session.prompt()`
  // sends "/reload" to the model as literal user text (agent_test.ts), so the chat
  // store intercepts these before they ever get that far.
  const pique: CommandInfo[] = [{
    name: "new",
    description:
      "Start a new chat, leaving this conversation behind (also /clear)",
    source: "pique",
  }, {
    name: "reload",
    description: "Re-read extensions, prompts and skills from disk",
    source: "pique",
  }];
  const ext: CommandInfo[] = session.extensionRunner.getRegisteredCommands()
    // deno-lint-ignore no-explicit-any
    .map((c: any) => ({
      name: c.invocationName,
      description: c.description ?? "",
      source: "extension",
    }));
  // A project template and a global one can share a name; pi's loader collapses that
  // itself, first path wins, so this list holds no twins.
  // deno-lint-ignore no-explicit-any
  const prompts: CommandInfo[] = session.promptTemplates.map((t: any) => ({
    name: t.name,
    description: t.description ?? "",
    source: "prompt",
    argumentHint: t.argumentHint,
  }));
  const skills: CommandInfo[] = session.resourceLoader.getSkills().skills.map((
    // deno-lint-ignore no-explicit-any
    s: any,
  ) => ({
    name: `skill:${s.name}`,
    description: s.description ?? "",
    source: "skill",
  }));
  return [...pique, ...ext, ...prompts, ...skills];
}
