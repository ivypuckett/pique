import { assertEquals, assertRejects } from "@std/assert";
import { subagentTools } from "./agent-tools.ts";
import { parseAgentDef } from "./parse.ts";
import { agentPath } from "./paths.ts";
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
