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

Deno.test("toFrontendEvent maps a tool start", () => {
  const out = toFrontendEvent({
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "bash",
    args: { command: "ls" },
  });
  assertEquals(out, { kind: "tool_start", id: "c1", name: "bash", args: '{"command":"ls"}' });
});

Deno.test("toFrontendEvent maps a tool end", () => {
  const out = toFrontendEvent({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "bash",
    result: "file.txt",
    isError: false,
  });
  assertEquals(out, { kind: "tool_end", id: "c1", name: "bash", result: "file.txt", isError: false });
});

Deno.test("toFrontendEvent stringifies non-string tool results", () => {
  const out = toFrontendEvent({
    type: "tool_execution_end",
    toolCallId: "c2",
    toolName: "read",
    result: { lines: 3 },
    isError: false,
  });
  assertEquals(out, { kind: "tool_end", id: "c2", name: "read", result: '{"lines":3}', isError: false });
});
