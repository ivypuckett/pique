// Deno-side pi agent wrapper. Runs in the desktop process only.
// `toFrontendEvent` is the pure, JSON-safe projection of pi's SDK events that
// crosses the win.bind boundary — keep its output plain JSON (see bindings.ts).

export type ChatEvent =
  | { kind: "text"; delta: string }
  | { kind: "thinking"; delta: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

// deno-lint-ignore no-explicit-any
export function toFrontendEvent(event: any): ChatEvent | null {
  if (event?.type === "message_update") {
    const ev = event.assistantMessageEvent;
    if (ev?.type === "text_delta") return { kind: "text", delta: ev.delta };
    if (ev?.type === "thinking_delta") return { kind: "thinking", delta: ev.delta };
  }
  return null;
}

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  // deno-lint-ignore no-explicit-any
} from "@earendil-works/pi-coding-agent";

// deno-lint-ignore no-explicit-any
type Session = any;

let session: Session | undefined;
let unsubscribe: (() => void) | undefined;
const queue: ChatEvent[] = [];

export async function startAgent(): Promise<void> {
  if (session) return;
  const modelRuntime = await ModelRuntime.create();
  // M1 runs against a local LM Studio server (google/gemma-4-e4b), configured in
  // ~/.pi/agent/models.json. Pinned explicitly so pique's chat doesn't depend on
  // the user's global pi default model. (Model selection UI is a later milestone.)
  const model = modelRuntime.getModel("lmstudio", "google/gemma-4-e4b");
  const created = await createAgentSession({
    model,
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    thinkingLevel: "off", // pure text chat; avoids reasoning_effort quirks on local servers
    tools: [], // M1: pure text chat. Tools (bash/read/edit) are enabled in M4.
  });
  session = created.session;
  unsubscribe = session.subscribe((event: unknown) => {
    const mapped = toFrontendEvent(event);
    if (mapped) queue.push(mapped);
  });
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
