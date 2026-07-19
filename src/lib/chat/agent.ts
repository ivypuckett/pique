// Deno-side pi agent wrapper. Runs in the desktop process only.
// `toFrontendEvent` is the pure, JSON-safe projection of pi's SDK events that
// crosses the win.bind boundary — keep its output plain JSON (see bindings.ts).

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModelInfo = { provider: string; id: string; name: string; current: boolean };

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
import { readJson } from "../settings/file.ts";

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

let session: Session | undefined;
let unsubscribe: (() => void) | undefined;
const queue: ChatEvent[] = [];
// deno-lint-ignore no-explicit-any
let runtime: any | undefined;

export async function startAgent(): Promise<void> {
  if (session) return;
  runtime = await ModelRuntime.create();
  const modelRuntime = runtime;
  // Startup model/thinking come from persisted chat defaults (~/.pique/settings.json);
  // fall back to the consts when unset or when the persisted model isn't available.
  const { provider, modelId, thinking } = resolveChatDefaults(await readJson("settings"));
  const model = modelRuntime.getModel(provider, modelId) ??
    modelRuntime.getModel(FALLBACK_PROVIDER, FALLBACK_MODEL);
  const created = await createAgentSession({
    model,
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
  });
  session = created.session;
  unsubscribe = session.subscribe((event: unknown) => {
    const mapped = toFrontendEvent(event);
    if (mapped) queue.push(mapped);
  });
  session.setThinkingLevel(thinking);
}

export function promptAgent(text: string): void {
  if (!session) throw new Error("chat agent not started");
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
export async function readAgent(): Promise<ChatEvent[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (queue.length) return queue.splice(0, queue.length);
    await new Promise((r) => setTimeout(r, 15));
  }
  return [];
}

export async function abortAgent(): Promise<void> {
  await session?.abort();
}

export async function listModels(): Promise<ModelInfo[]> {
  if (!runtime || !session) return [];
  const current = session.model;
  // deno-lint-ignore no-explicit-any
  const available: any[] = await runtime.getAvailable();
  return available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
    current: m.provider === current?.provider && m.id === current?.id,
  }));
}

export async function setModel(provider: string, id: string): Promise<void> {
  if (!runtime || !session) return;
  const model = runtime.getModel(provider, id);
  if (model) await session.setModel(model);
}

export function setThinkingLevel(level: ThinkingLevel): void {
  session?.setThinkingLevel(level);
}
