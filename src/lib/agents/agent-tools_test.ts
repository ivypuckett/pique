import { assertEquals, assertRejects } from "@std/assert";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { subagentTools } from "./agent-tools.ts";
import { parseAgentDef } from "./parse.ts";
import { agentPath, agentsDir } from "./paths.ts";
import { ROOT } from "../scope/paths.ts";

// Tool.execute has extra pi-runtime params (signal/onUpdate/ctx) unused by these
// assertions besides signal — pass undefined and read the text content back out.
// deno-lint-ignore no-explicit-any
async function run(tool: any, params: unknown): Promise<string> {
  const res = await tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    undefined,
  );
  return res.content[0].text;
}

// deno-lint-ignore no-explicit-any
const byName = (tools: any[], name: string) =>
  tools.find((t) => t.name === name);

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

const scout = { name: "scout", description: "fast recon" };

Deno.test("the tool description lists every available agent by name and description", () => {
  const tools = subagentTools(
    ROOT,
    "/tmp",
    // deno-lint-ignore no-explicit-any
    undefined as any,
    undefined,
    [scout],
  );
  assertEquals(
    byName(tools, "run_subagent").description.includes("scout: fast recon"),
    true,
  );
});

Deno.test("an unknown agent name is rejected before runSubagent is ever called", async () => {
  await withTempHome(async () => {
    const tools = subagentTools(
      ROOT,
      "/tmp",
      // deno-lint-ignore no-explicit-any
      undefined as any,
      undefined,
      [scout],
    );
    await assertRejects(
      () =>
        run(byName(tools, "run_subagent"), { agent: "nonexistent", task: "x" }),
      Error,
      "no subagent named",
    );
  });
});

Deno.test("define_subagent writes a definition run_subagent can immediately see", async () => {
  await withTempHome(async () => {
    const tools = subagentTools(
      ROOT,
      "/tmp",
      // deno-lint-ignore no-explicit-any
      undefined as any,
      undefined,
      [], // empty at session start — define_subagent adds one mid-conversation
    );

    await run(byName(tools, "define_subagent"), {
      name: "planner",
      description: "Makes implementation plans",
      system_prompt: "You plan before you code.",
      tools: ["read", "grep"],
      model: "claude-haiku-4-5",
    });

    const def = parseAgentDef(
      "planner",
      await Deno.readTextFile(agentPath(ROOT, "planner")),
    );
    assertEquals(def.description, "Makes implementation plans");
    assertEquals(def.systemPrompt, "You plan before you code.");
    assertEquals(def.tools, ["read", "grep"]);
    assertEquals(def.model, "claude-haiku-4-5");

    // The initial (session-start) list was empty, but run_subagent re-reads from disk
    // on every call, so the rejection for an UNRELATED name still names "planner" as
    // available — proof the freshly defined subagent is visible without a reload.
    await assertRejects(
      () => run(byName(tools, "run_subagent"), { agent: "nope", task: "x" }),
      Error,
      "planner",
    );
  });
});

// --- the progress the parent sees while a delegation is still running ---

// One endpoint serving a scripted turn and then the reply that ends the run, so the
// child can call tools before it answers. Same shape as service_test.ts's mock, kept
// local the way the other integration tests here keep theirs.
const REPLY = "done looking";

function chunk(choice: unknown): string {
  return `data: ${
    JSON.stringify({
      id: "mock-completion",
      object: "chat.completion.chunk",
      created: 0,
      model: "mock-model",
      choices: [choice],
    })
  }\n\n`;
}

// `count` ls calls in one assistant message, so a test can make the child busy without
// scripting a turn per call.
function toolTurn(count: number): string {
  return chunk({
    index: 0,
    delta: {
      role: "assistant",
      tool_calls: Array.from({ length: count }, (_, i) => ({
        index: i,
        id: `call-${i}`,
        type: "function",
        function: { name: "ls", arguments: `{"path":".","n":${i}}` },
      })),
    },
  }) + chunk({ index: 0, delta: {}, finish_reason: "tool_calls" }) +
    "data: [DONE]\n\n";
}

const TEXT_TURN = chunk({
  index: 0,
  delta: { role: "assistant", content: REPLY },
}) + chunk({ index: 0, delta: {}, finish_reason: "stop" }) +
  "data: [DONE]\n\n";

let scripted: string[] = [];
const server = Deno.serve(
  { port: 0, onListen: () => {} },
  () =>
    new Response(scripted.shift() ?? TEXT_TURN, {
      headers: { "content-type": "text/event-stream" },
    }),
);
server.unref();
const baseUrl = `http://localhost:${(server.addr as Deno.NetAddr).port}/v1`;

// Everything both progress tests need: a mock provider, a definition, and the tools
// bound to root. Returns run_subagent's execute, already curried with the scout.
async function withScout(
  fn: (
    // deno-lint-ignore no-explicit-any
    delegate: (onUpdate?: (partial: any) => void) => Promise<any>,
  ) => Promise<void>,
): Promise<void> {
  await withTempHome(async () => {
    const home = Deno.env.get("HOME")!;
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
    await Deno.mkdir(agentsDir(ROOT), { recursive: true });
    await Deno.writeTextFile(
      agentPath(ROOT, "scout"),
      "---\ndescription: recon\ntools: ls\n---\nYou are a scout.\n",
    );

    const runtime = await ModelRuntime.create();
    const tools = subagentTools(
      ROOT,
      home,
      runtime,
      runtime.getModel("mock", "mock-model"),
      [scout],
    );
    await fn((onUpdate) =>
      // deno-lint-ignore no-explicit-any
      (byName(tools, "run_subagent") as any).execute(
        "call-parent",
        { agent: "scout", task: "look around" },
        undefined,
        onUpdate,
        undefined,
      )
    );
  });
}

Deno.test("run_subagent streams the child's tool calls back through onUpdate", async () => {
  await withScout(async (delegate) => {
    scripted = [toolTurn(1)];
    // deno-lint-ignore no-explicit-any
    const updates: any[] = [];
    const res = await delegate((partial) => updates.push(partial));

    assertEquals(
      updates.map((u) => u.content[0].text),
      ['ls {"path":".","n":0}'],
      "the child's tool call reaches the parent before the run returns",
    );
    assertEquals(res.content[0].text, REPLY, "the final result still wins");
  });
});

// The block is re-sent whole on every line and rendered through a projection that
// truncates from the END, so an unbounded one would pin the display to the child's
// first calls and never show the one running now.
Deno.test("run_subagent's progress block stays bounded for a busy child", async () => {
  await withScout(async (delegate) => {
    scripted = [toolTurn(20)];
    // deno-lint-ignore no-explicit-any
    const updates: any[] = [];
    await delegate((partial) => updates.push(partial));

    assertEquals(
      updates.length,
      20,
      "one update per tool call, all 20 of them",
    );
    // Each update ends with the line it just added, whatever order the child's calls
    // happened to start in — so the final block must be the newest eight of those.
    const added = updates.map((u) =>
      u.content[0].text.split("\n").at(-1) as string
    );
    assertEquals(
      updates.at(-1).content[0].text.split("\n"),
      added.slice(-8),
      "the block keeps the most recent calls and drops the oldest",
    );
  });
});

Deno.test("a run with no onUpdate still returns its result", async () => {
  await withScout(async (delegate) => {
    scripted = [toolTurn(1)];
    const res = await delegate(undefined);
    assertEquals(res.content[0].text, REPLY);
  });
});

Deno.test("define_subagent's reach message differs for root vs a workspace", async () => {
  await withTempHome(async () => {
    const rootTools = subagentTools(
      ROOT,
      "/tmp",
      // deno-lint-ignore no-explicit-any
      undefined as any,
      undefined,
      [],
    );
    const wsTools = subagentTools(
      "ws-1",
      "/tmp",
      // deno-lint-ignore no-explicit-any
      undefined as any,
      undefined,
      [],
    );
    const rootReply = await run(byName(rootTools, "define_subagent"), {
      name: "a",
      description: "d",
      system_prompt: "p",
    });
    const wsReply = await run(byName(wsTools, "define_subagent"), {
      name: "b",
      description: "d",
      system_prompt: "p",
    });
    assertEquals(rootReply.includes("every workspace"), true);
    assertEquals(wsReply.includes("only there"), true);
  });
});
