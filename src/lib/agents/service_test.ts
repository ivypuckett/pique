import { assertEquals, assertRejects } from "@std/assert";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  deleteAgent,
  listAgents,
  listVisibleAgents,
  progressLine,
  runSubagent,
  saveAgent,
} from "./service.ts";
import { parseAgentDef } from "./parse.ts";
import { agentsDir } from "./paths.ts";
import { ROOT } from "../scope/paths.ts";

async function withTempHome(
  fn: (home: string) => Promise<void>,
): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn(dir);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function writeAgent(
  scope: string,
  name: string,
  text: string,
): Promise<void> {
  await Deno.mkdir(agentsDir(scope), { recursive: true });
  await Deno.writeTextFile(`${agentsDir(scope)}/${name}.md`, text);
}

Deno.test("listAgents reads and parses every definition in the scope's dir", async () => {
  await withTempHome(async () => {
    await writeAgent(ROOT, "scout", "---\ndescription: recon\n---\nBe fast.\n");
    await writeAgent(
      ROOT,
      "worker",
      "---\ndescription: general\n---\nDo work.\n",
    );
    const defs = await listAgents(ROOT);
    assertEquals(defs.map((d) => d.name).sort(), ["scout", "worker"]);
  });
});

Deno.test("a scope with no agents dir yet lists none, not an error", async () => {
  await withTempHome(async () => {
    assertEquals(await listAgents("ws-9"), []);
  });
});

// The human write path. It creates the dir, so the Library can save the first definition
// into a scope that has never had one.
Deno.test("saveAgent writes a definition listAgents reads back", async () => {
  await withTempHome(async () => {
    await saveAgent("ws-9", "scout", {
      description: "recon",
      tools: ["read", "grep"],
      model: "claude-haiku-4-5",
      systemPrompt: "Be fast.",
    });
    const [def] = await listAgents("ws-9");
    assertEquals(def.description, "recon");
    assertEquals(def.tools, ["read", "grep"]);
    assertEquals(def.model, "claude-haiku-4-5");
    assertEquals(def.systemPrompt, "Be fast.");
  });
});

Deno.test("saving an existing name replaces it rather than adding a second", async () => {
  await withTempHome(async () => {
    await saveAgent(ROOT, "scout", { description: "old", systemPrompt: "A." });
    await saveAgent(ROOT, "scout", { description: "new", systemPrompt: "B." });
    const defs = await listAgents(ROOT);
    assertEquals(defs.length, 1);
    assertEquals(defs[0].description, "new");
  });
});

// The same guard define_subagent is held to: a name is a filename, so one carrying a
// separator would write outside the scope's dir.
Deno.test("saveAgent refuses a name that is not a legal filename stem", async () => {
  await withTempHome(async () => {
    await assertRejects(() =>
      saveAgent(ROOT, "../escape", { description: "", systemPrompt: "x" })
    );
  });
});

Deno.test("deleteAgent removes the definition", async () => {
  await withTempHome(async () => {
    await writeAgent(ROOT, "scout", "---\ndescription: recon\n---\nBe fast.\n");
    await deleteAgent(ROOT, "scout");
    assertEquals(await listAgents(ROOT), []);
  });
});

Deno.test("listVisibleAgents inherits root, and a workspace's own shadows it", async () => {
  await withTempHome(async () => {
    await writeAgent(
      ROOT,
      "scout",
      "---\ndescription: root scout\n---\nRoot body.\n",
    );
    await writeAgent(
      ROOT,
      "planner",
      "---\ndescription: root planner\n---\nPlan.\n",
    );
    await writeAgent(
      "ws-1",
      "scout",
      "---\ndescription: ws-1 scout\n---\nWs body.\n",
    );

    const defs = await listVisibleAgents("ws-1");
    assertEquals(defs.map((d) => d.name).sort(), ["planner", "scout"]);
    assertEquals(
      defs.find((d) => d.name === "scout")?.description,
      "ws-1 scout",
      "the workspace's own definition must shadow root's same-named one",
    );
  });
});

// --- runSubagent: an isolated nested session against a mocked model endpoint ---

const REPLY = "subagent-reply-ok";

function sse(): string {
  const chunk = (choice: unknown) =>
    `data: ${
      JSON.stringify({
        id: "mock-completion",
        object: "chat.completion.chunk",
        created: 0,
        model: "mock-model",
        choices: [choice],
      })
    }\n\n`;
  return chunk({ index: 0, delta: { role: "assistant", content: REPLY } }) +
    chunk({ index: 0, delta: {}, finish_reason: "stop" }) +
    "data: [DONE]\n\n";
}

// One streamed tool call, so a test can make the child do something before it answers.
function sseToolCall(name: string, args: unknown): string {
  const chunk = (choice: unknown) =>
    `data: ${
      JSON.stringify({
        id: "mock-completion",
        object: "chat.completion.chunk",
        created: 0,
        model: "mock-model",
        choices: [choice],
      })
    }\n\n`;
  return chunk({
    index: 0,
    delta: {
      role: "assistant",
      tool_calls: [{
        index: 0,
        id: "call-1",
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      }],
    },
  }) +
    chunk({ index: 0, delta: {}, finish_reason: "tool_calls" }) +
    "data: [DONE]\n\n";
}

let lastRequest = "";
// Responses to serve before falling back to the plain reply, oldest first. A child that
// makes a tool call needs two turns, and both come from this one endpoint.
let scripted: string[] = [];

const server = Deno.serve(
  { port: 0, onListen: () => {} },
  async (req) => {
    lastRequest = await req.text();
    return new Response(scripted.shift() ?? sse(), {
      headers: { "content-type": "text/event-stream" },
    });
  },
);
server.unref();
const baseUrl = `http://localhost:${(server.addr as Deno.NetAddr).port}/v1`;

async function withMockRuntime(
  fn: (runtime: ModelRuntime, cwd: string) => Promise<void>,
): Promise<void> {
  await withTempHome(async (home) => {
    const cwd = await Deno.makeTempDir();
    scripted = [];
    try {
      await Deno.mkdir(`${home}/.pi/agent`, { recursive: true });
      await Deno.writeTextFile(
        `${home}/.pi/agent/models.json`,
        JSON.stringify({
          providers: {
            mock: {
              baseUrl,
              api: "openai-completions",
              apiKey: "mock",
              models: [{
                id: "mock-model",
                contextWindow: 128000,
                input: ["text"],
              }],
            },
          },
        }),
      );
      const runtime = await ModelRuntime.create();
      await fn(runtime, cwd);
    } finally {
      await Deno.remove(cwd, { recursive: true });
    }
  });
}

Deno.test("runSubagent runs the definition's system prompt and returns its reply", async () => {
  await withMockRuntime(async (runtime, cwd) => {
    lastRequest = "";
    const def = parseAgentDef(
      "scout",
      "---\ndescription: recon\n---\nYou are a scout.\n",
    );
    const fallbackModel = runtime.getModel("mock", "mock-model");
    const result = await runSubagent({
      def,
      task: "find the thing",
      cwd,
      modelRuntime: runtime,
      fallbackModel,
    });
    assertEquals(result, REPLY);

    const body = JSON.parse(lastRequest);
    const system = body.messages.find((m: { role: string }) =>
      m.role === "system"
    );
    assertEquals(
      JSON.stringify(system).includes("You are a scout."),
      true,
      "the definition's body must reach the child as its system prompt",
    );
  });
});

Deno.test("progressLine projects the child's tool calls and nothing else", () => {
  assertEquals(
    progressLine({
      type: "tool_execution_start",
      toolName: "read",
      args: { file: "a.ts" },
    }),
    'read {"file":"a.ts"}',
  );
  assertEquals(
    progressLine({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi" },
    }),
    null,
    "the child's text is the call's return value; streaming it too would say it twice",
  );
  assertEquals(progressLine(undefined), null);
});

Deno.test("runSubagent reports each tool call the child makes, as it makes it", async () => {
  await withMockRuntime(async (runtime, cwd) => {
    // Turn one is a tool call, turn two the reply that ends the run.
    scripted = [sseToolCall("ls", { path: "." })];
    const def = parseAgentDef(
      "scout",
      "---\ndescription: recon\ntools: ls\n---\nYou are a scout.\n",
    );
    const seen: string[] = [];
    const result = await runSubagent({
      def,
      task: "look around",
      cwd,
      modelRuntime: runtime,
      fallbackModel: runtime.getModel("mock", "mock-model"),
      onProgress: (line) => seen.push(line),
    });
    assertEquals(result, REPLY);
    assertEquals(
      seen,
      ['ls {"path":"."}'],
      "the parent has to see the child working, or a long run looks like a hang",
    );
  });
});

Deno.test("runSubagent falls back to the parent's model when the definition names none", async () => {
  await withMockRuntime(async (runtime, cwd) => {
    lastRequest = "";
    const def = parseAgentDef("worker", "---\ndescription: d\n---\nWork.\n");
    const fallbackModel = runtime.getModel("mock", "mock-model");
    await runSubagent({
      def,
      task: "do it",
      cwd,
      modelRuntime: runtime,
      fallbackModel,
    });
    assertEquals(JSON.parse(lastRequest).model, "mock-model");
  });
});
