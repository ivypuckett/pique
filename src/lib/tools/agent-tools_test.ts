import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { toolAuthoringTools } from "./agent-tools.ts";
import { listTools, readSource } from "./service.ts";
import { liveDir } from "./paths.ts";
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

// Tool.execute has extra pi-runtime params (signal/onUpdate/ctx) unused here.
// deno-lint-ignore no-explicit-any
function defineToolTool(scope: ScopeId): any {
  return toolAuthoringTools(scope).find((t) => t.name === "define_tool");
}
// deno-lint-ignore no-explicit-any
const run = (tool: any, params: unknown) =>
  tool.execute("call-1", params, undefined, undefined, undefined);

Deno.test("define_tool quarantines the source and never writes to the live dir", async () => {
  await withTempHome(async () => {
    const res = await run(defineToolTool("ws-1"), {
      name: "lookup_weather",
      rationale: "user keeps asking about the forecast",
      source: "export default function (pi) {}",
    });

    assertEquals(await listTools("ws-1"), [
      { name: "lookup_weather", state: "pending", scope: "ws-1" },
    ]);
    // The whole point of the gate: nothing reached the dir pi auto-discovers.
    assertEquals([...Deno.readDirSync(liveDir("ws-1"))].length, 0);
    assertStringIncludes(res.content[0].text, "not callable yet");
  });
});

Deno.test("define_tool writes into its own scope, not root's", async () => {
  await withTempHome(async () => {
    await run(defineToolTool("ws-1"), {
      name: "local_tool",
      rationale: "r",
      source: "export default function (pi) {}",
    });
    assertEquals(await listTools(ROOT), []);
    assertEquals((await listTools("ws-1")).map((t) => t.name), ["local_tool"]);
  });
});

Deno.test("define_tool tells a root agent its tool reaches every workspace", () => {
  assertStringIncludes(defineToolTool(ROOT).description, "every workspace");
  assertStringIncludes(defineToolTool("ws-1").description, "only there");
});

Deno.test("define_tool records the rationale alongside the source for the reviewer", async () => {
  await withTempHome(async () => {
    await run(defineToolTool("ws-1"), {
      name: "lookup_weather",
      rationale: "user keeps asking\nabout the forecast",
      source: "export default function (pi) {}",
    });

    const src = await readSource("ws-1", "lookup_weather", "pending");
    // Newlines flattened so the rationale cannot break out of its comment line.
    assertStringIncludes(src.split("\n")[0], "Rationale: user keeps asking about the forecast");
    assertStringIncludes(src, "export default function (pi) {}");
  });
});

Deno.test("define_tool rejects a name that would escape the pending dir", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => run(defineToolTool("ws-1"), { name: "../evil", rationale: "r", source: "x" }),
      Error,
      "invalid tool name",
    );
  });
});
