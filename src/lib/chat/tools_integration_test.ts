// End-to-end check of what a chat agent can call: everything pi finds in its agent dir —
// a local extension, an installed package — plus pique's own define_module. Everything
// below goes through the real startAgent path, the same one the desktop bindings call.
import { assertEquals } from "@std/assert";
import { activeToolNames, startAgent, stopAgent } from "./agent.ts";
import { installPackage } from "../extensions/service.ts";
import { ensureExtensionDirs, livePath } from "../extensions/paths.ts";

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

// A real pi extension module, so this exercises the loader rather than a stub.
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

// Start an agent, read its tools, and always tear it down.
async function tools(): Promise<string[]> {
  const id = await startAgent();
  try {
    return activeToolNames(id);
  } finally {
    stopAgent(id);
  }
}

Deno.test("a local extension in pi's agent dir reaches the agent", async () => {
  await withTempHome(async () => {
    await ensureExtensionDirs();
    await Deno.writeTextFile(
      livePath("local_tool"),
      extensionSource("local_tool"),
    );
    assertEquals((await tools()).includes("local_tool"), true);
  });
});

Deno.test("pique's compiled-in define_module is present", async () => {
  await withTempHome(async () => {
    assertEquals((await tools()).includes("define_module"), true);
  });
});

// Network-free by using a local-path package source, the way
// extensions/integration_test.ts does — pi accepts one wherever it accepts npm:.
Deno.test("an installed package reaches the agent", async () => {
  await withTempHome(async (home) => {
    const pkg = `${home}/pkg`;
    await Deno.mkdir(`${pkg}/extensions`, { recursive: true });
    await Deno.writeTextFile(
      `${pkg}/package.json`,
      JSON.stringify({ name: "fixture-pkg", version: "1.0.0" }),
    );
    await Deno.writeTextFile(
      `${pkg}/extensions/pkg_tool.ts`,
      extensionSource("pkg_tool"),
    );
    await installPackage(pkg);

    assertEquals((await tools()).includes("pkg_tool"), true);
  });
});
