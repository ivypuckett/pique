// Deno-side pi agent wrapper. Runs in the desktop process only.
// `toFrontendEvent` is the pure, JSON-safe projection of pi's SDK events that
// crosses the win.bind boundary — keep its output plain JSON (see bindings.ts).

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelInfo = { provider: string; id: string; name: string; current: boolean };
// JSON-safe projection of pi's SlashCommandInfo for the chat `/` menu. Mirrors the
// three sources pi's TUI lists (extension commands, prompt templates, skills); the
// `name` is the token typed after `/`, so skills already carry their `skill:` prefix.
export type CommandInfo = { name: string; description: string; source: "extension" | "prompt" | "skill" };

export type ChatEvent =
  | { kind: "text"; delta: string }
  | { kind: "thinking"; delta: string }
  | { kind: "tool_start"; id: string; name: string; args: string }
  | { kind: "tool_end"; id: string; name: string; result: string; isError: boolean }
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
      if (ev?.type === "thinking_delta") return { kind: "thinking", delta: ev.delta };
      return null;
    }
    case "tool_execution_start":
      return { kind: "tool_start", id: event.toolCallId, name: event.toolName, args: preview(event.args) };
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
  ModelRuntime,
  SessionManager,
  // deno-lint-ignore no-explicit-any
} from "@earendil-works/pi-coding-agent";
import { piAgentDir, readJson, resolveModuleDir } from "../settings/file.ts";

// deno-lint-ignore no-explicit-any
type Session = any;

// The startup model when nothing is persisted, or when the persisted model is
// unavailable in the runtime. Was the hardcoded M1 pin; now only the fallback.
const FALLBACK_PROVIDER = "lmstudio";
const FALLBACK_MODEL = "google/gemma-4-e4b";

// Pure projection of persisted settings → the agent's startup model + thinking.
// `settings` is whatever readJson("settings") returned: possibly null, missing
// `chat`, or holding non-string values, so every field is guarded.
export function resolveChatDefaults(
  settings: unknown,
): { provider: string; modelId: string; thinking: ThinkingLevel } {
  const chat = (settings as { chat?: Record<string, unknown> } | null)?.chat ?? {};
  const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
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
}
const agents = new Map<string, Agent>();
let nextId = 1;
// deno-lint-ignore no-explicit-any
let runtime: any | undefined;

// The single shared ModelRuntime, created lazily. Exported so provider
// management (providers.ts) mutates the same runtime the chat agents stream
// from — auth/models changes there take effect without a restart.
export async function ensureRuntime() {
  if (!runtime) runtime = await ModelRuntime.create();
  return runtime;
}

// Start a fresh agent and return its id. `cwd` is the per-workspace override
// threaded from the frontend; blank/absent falls back to the global default.
export async function startAgent(opts: { cwd?: string } = {}): Promise<string> {
  const modelRuntime = await ensureRuntime();
  // Startup model/thinking come from persisted chat defaults (~/.pique/settings.json);
  // fall back to the consts when unset or when the persisted model isn't available.
  const rawSettings = await readJson("settings");
  const { provider, modelId, thinking } = resolveChatDefaults(rawSettings);
  const cwd = resolveModuleDir(opts.cwd, rawSettings);
  const model = modelRuntime.getModel(provider, modelId) ??
    modelRuntime.getModel(FALLBACK_PROVIDER, FALLBACK_MODEL);
  const created = await createAgentSession({
    model,
    cwd,
    // Load extensions from pique's own dir (~/.pique/agent), separate from the
    // user's `pi` CLI. Safe: auth + models.json still come from ~/.pi/agent via the
    // shared modelRuntime below, and the in-memory sessionManager ignores agentDir.
    agentDir: piAgentDir(),
    sessionManager: SessionManager.inMemory(),
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
  agents.set(id, { session, unsubscribe, queue });
  return id;
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
      queue.push({ kind: "error", message: err instanceof Error ? err.message : String(err) });
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
  // deno-lint-ignore no-explicit-any
  const available: any[] = await runtime.getAvailable();
  return available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
    current: m.provider === current?.provider && m.id === current?.id,
  }));
}

export async function setModel(id: string, provider: string, modelId: string): Promise<void> {
  const agent = agents.get(id);
  if (!runtime || !agent) return;
  const model = runtime.getModel(provider, modelId);
  if (model) await agent.session.setModel(model);
}

export function setThinkingLevel(id: string, level: ThinkingLevel): void {
  agents.get(id)?.session.setThinkingLevel(level);
}

// The `/` menu list: the same three sources pi's TUI concatenates in getCommands —
// extension commands, file-based prompt templates, and skills (prefixed `skill:`).
// pi's own builtins (/model, /settings, …) are TUI actions pique covers in its own
// UI, so they're omitted. session.prompt() already expands/runs all three, so the
// menu only helps compose the text — no execution logic lives here.
export function listCommands(id: string): CommandInfo[] {
  const session = agents.get(id)?.session;
  if (!session) return [];
  // deno-lint-ignore no-explicit-any
  const ext: CommandInfo[] = session.extensionRunner.getRegisteredCommands().map((c: any) => ({
    name: c.invocationName,
    description: c.description ?? "",
    source: "extension",
  }));
  // deno-lint-ignore no-explicit-any
  const prompts: CommandInfo[] = session.promptTemplates.map((t: any) => ({
    name: t.name,
    description: t.description ?? "",
    source: "prompt",
  }));
  // deno-lint-ignore no-explicit-any
  const skills: CommandInfo[] = session.resourceLoader.getSkills().skills.map((s: any) => ({
    name: `skill:${s.name}`,
    description: s.description ?? "",
    source: "skill",
  }));
  return [...ext, ...prompts, ...skills];
}
