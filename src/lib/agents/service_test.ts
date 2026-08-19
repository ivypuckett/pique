import { assertEquals } from "@std/assert";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { listAgents, listVisibleAgents, runSubagent } from "./service.ts";
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

let lastRequest = "";

const server = Deno.serve(
  { port: 0, onListen: () => {} },
  async (req) => {
    lastRequest = await req.text();
    return new Response(sse(), {
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
