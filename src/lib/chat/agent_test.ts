import { assertEquals } from "@std/assert";
import { resolveChatDefaults, toFrontendEvent, toHistory } from "./agent.ts";

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
    toFrontendEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_end" },
    }),
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
  assertEquals(out, {
    kind: "tool_start",
    id: "c1",
    name: "bash",
    args: '{"command":"ls"}',
  });
});

Deno.test("toFrontendEvent maps a tool end", () => {
  const out = toFrontendEvent({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "bash",
    result: "file.txt",
    isError: false,
  });
  assertEquals(out, {
    kind: "tool_end",
    id: "c1",
    name: "bash",
    result: "file.txt",
    isError: false,
  });
});

Deno.test("toFrontendEvent stringifies non-string tool results", () => {
  const out = toFrontendEvent({
    type: "tool_execution_end",
    toolCallId: "c2",
    toolName: "read",
    result: { lines: 3 },
    isError: false,
  });
  assertEquals(out, {
    kind: "tool_end",
    id: "c2",
    name: "read",
    result: '{"lines":3}',
    isError: false,
  });
});

Deno.test("toHistory rebuilds a transcript from stored messages", () => {
  assertEquals(
    toHistory([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "listing" },
          {
            type: "toolCall",
            id: "c1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        content: [{ type: "text", text: "file.txt" }],
        isError: false,
      },
    ]),
    [
      { role: "user", text: "hi" },
      { role: "thinking", text: "hmm" },
      { role: "assistant", text: "listing" },
      {
        role: "tool",
        id: "c1",
        name: "bash",
        args: '{"command":"ls"}',
        result: "file.txt",
        isError: false,
        done: true,
      },
    ],
  );
});

Deno.test("toHistory reads user content in block form, dropping images", () => {
  assertEquals(
    toHistory([{
      role: "user",
      content: [{ type: "text", text: "look" }, {
        type: "image",
        data: "…",
        mimeType: "image/png",
      }],
    }]),
    [{ role: "user", text: "look" }],
  );
});

Deno.test("toHistory leaves a tool call with no result unfinished", () => {
  // The app closed mid-tool: the call is in the session, its result never was.
  assertEquals(
    toHistory([{
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }],
    }]),
    [{
      role: "tool",
      id: "c1",
      name: "read",
      args: "{}",
      result: "",
      isError: false,
      done: false,
    }],
  );
});

Deno.test("toHistory drops roles that are context rather than transcript", () => {
  assertEquals(
    toHistory([
      { role: "compactionSummary", summary: "earlier work", tokensBefore: 100 },
      { role: "bashExecution", command: "ls", output: "file.txt", exitCode: 0 },
      { role: "user", content: "carry on" },
    ]),
    [{ role: "user", text: "carry on" }],
  );
});

Deno.test("resolveChatDefaults falls back on null", () => {
  assertEquals(resolveChatDefaults(null), {
    provider: "lmstudio",
    modelId: "google/gemma-4-e4b",
    thinking: "off",
  });
});

Deno.test("resolveChatDefaults falls back on empty / missing chat", () => {
  assertEquals(resolveChatDefaults({}), {
    provider: "lmstudio",
    modelId: "google/gemma-4-e4b",
    thinking: "off",
  });
  assertEquals(resolveChatDefaults({ chat: {} }), {
    provider: "lmstudio",
    modelId: "google/gemma-4-e4b",
    thinking: "off",
  });
});

Deno.test("resolveChatDefaults reads a full chat config", () => {
  assertEquals(
    resolveChatDefaults({
      chat: {
        defaultProvider: "openai",
        defaultModel: "gpt-x",
        defaultThinkingLevel: "high",
      },
    }),
    { provider: "openai", modelId: "gpt-x", thinking: "high" },
  );
});

Deno.test("resolveChatDefaults fills only the missing fields", () => {
  assertEquals(
    resolveChatDefaults({ chat: { defaultThinkingLevel: "low" } }),
    { provider: "lmstudio", modelId: "google/gemma-4-e4b", thinking: "low" },
  );
});

Deno.test("resolveChatDefaults ignores non-string values", () => {
  assertEquals(
    resolveChatDefaults({
      chat: {
        defaultProvider: 42,
        defaultModel: null,
        defaultThinkingLevel: {},
      },
    }),
    { provider: "lmstudio", modelId: "google/gemma-4-e4b", thinking: "off" },
  );
});
