// End-to-end check of the claim the scope tree exists to make: a chat agent in a
// workspace can call the tools that workspace defined AND the ones root shares,
// while a root agent can call neither workspace's. Everything below goes through the
// real startAgent path — the same one the desktop bindings call.
import { assertEquals } from "@std/assert";
import { activeToolNames, startAgent, stopAgent } from "./agent.ts";
import { enableLocal } from "../extensions/local.ts";
import { ensureExtensionDirs, pendingPath } from "../extensions/paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

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

// A real pi extension module — the same shape define_extension writes and a human
// approves, so this exercises the loader rather than a stub.
function extensionSource(name: string): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: ${JSON.stringify(name)},
    label: ${JSON.stringify(name)},
    description: "integration fixture",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: null };
    },
  });
}
`;
}

async function defineAndApprove(scope: ScopeId, name: string): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, name), extensionSource(name));
  await enableLocal(scope, name);
}

// Start an agent in `scope`, read its tools, and always tear it down.
async function toolsFor(scope: ScopeId): Promise<string[]> {
  const id = await startAgent({ scope });
  try {
    return activeToolNames(id);
  } finally {
    stopAgent(id);
  }
}

Deno.test("a workspace agent gets its own tools and the ones it inherits from root", async () => {
  await withTempHome(async () => {
    await defineAndApprove(ROOT, "shared_tool");
    await defineAndApprove("ws-1", "local_tool");

    const tools = await toolsFor("ws-1");
    assertEquals(
      tools.includes("shared_tool"),
      true,
      "root's tool should be inherited",
    );
    assertEquals(
      tools.includes("local_tool"),
      true,
      "the workspace's own tool should load",
    );
  });
});

Deno.test("a root agent cannot see a workspace's tools", async () => {
  await withTempHome(async () => {
    await defineAndApprove(ROOT, "shared_tool");
    await defineAndApprove("ws-1", "local_tool");

    const tools = await toolsFor(ROOT);
    assertEquals(tools.includes("shared_tool"), true);
    assertEquals(
      tools.includes("local_tool"),
      false,
      "root must not inherit downward",
    );
  });
});

Deno.test("sibling workspaces are isolated from each other", async () => {
  await withTempHome(async () => {
    await defineAndApprove("ws-1", "one_tool");
    await defineAndApprove("ws-2", "two_tool");

    const tools = await toolsFor("ws-1");
    assertEquals(tools.includes("one_tool"), true);
    assertEquals(
      tools.includes("two_tool"),
      false,
      "a sibling's tools must not leak",
    );
  });
});

Deno.test("a quarantined tool never reaches an agent", async () => {
  await withTempHome(async () => {
    // Written to pending but never approved — the gate the whole design rests on.
    await ensureExtensionDirs(ROOT);
    await Deno.writeTextFile(
      pendingPath(ROOT, "unapproved"),
      extensionSource("unapproved"),
    );

    assertEquals((await toolsFor("ws-1")).includes("unapproved"), false);
    assertEquals((await toolsFor(ROOT)).includes("unapproved"), false);
  });
});

Deno.test("pique's compiled-in tools are present in every scope", async () => {
  await withTempHome(async () => {
    for (const scope of [ROOT, "ws-1"]) {
      const tools = await toolsFor(scope);
      assertEquals(
        tools.includes("define_extension"),
        true,
        `define_extension missing in ${scope}`,
      );
      assertEquals(
        tools.includes("kanban_get_board"),
        true,
        `kanban tools missing in ${scope}`,
      );
    }
  });
});
