import { assertEquals } from "@std/assert";
import { toFrontendEvent } from "./agent.ts";

Deno.test("toFrontendEvent maps a text delta", () => {
  const out = toFrontendEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Hel" },
  });
  assertEquals(out, { kind: "text", delta: "Hel" });
});

Deno.test("toFrontendEvent maps a thinking delta", () => {
  const out = toFrontendEvent({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
  });
  assertEquals(out, { kind: "thinking", delta: "hmm" });
});

Deno.test("toFrontendEvent ignores unrelated events", () => {
  assertEquals(toFrontendEvent({ type: "agent_start" }), null);
  assertEquals(
    toFrontendEvent({ type: "message_update", assistantMessageEvent: { type: "text_end" } }),
    null,
  );
});
