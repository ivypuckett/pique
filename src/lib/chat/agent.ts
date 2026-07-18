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
