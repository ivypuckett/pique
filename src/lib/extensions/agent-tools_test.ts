import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { extensionAuthoringTools } from "./agent-tools.ts";
import { listLocal, readLocalSource } from "./local.ts";
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
function defineExtTool(scope: ScopeId): any {
  return extensionAuthoringTools(scope).find((t) => t.name === "define_extension");
}
// deno-lint-ignore no-explicit-any
const run = (tool: any, params: unknown) =>
  tool.execute("call-1", params, undefined, undefined, undefined);

Deno.test("define_extension quarantines the source and never writes to the live dir", async () => {
  await withTempHome(async () => {
    const res = await run(defineExtTool("ws-1"), {
      name: "lookup_weather",
      rationale: "user keeps asking about the forecast",
      source: "export default function (pi) {}",
    });

    assertEquals(await listLocal("ws-1"), [
      { name: "lookup_weather", state: "pending", scope: "ws-1" },
    ]);
    // The whole point of the gate: nothing reached the dir pi auto-discovers.
    assertEquals([...Deno.readDirSync(liveDir("ws-1"))].length, 0);
    assertStringIncludes(res.content[0].text, "not active yet");
  });
});

Deno.test("define_extension writes into its own scope, not root's", async () => {
  await withTempHome(async () => {
    await run(defineExtTool("ws-1"), {
      name: "local_tool",
      rationale: "r",
      source: "export default function (pi) {}",
    });
    assertEquals(await listLocal(ROOT), []);
    assertEquals((await listLocal("ws-1")).map((t) => t.name), ["local_tool"]);
  });
});

Deno.test("define_extension tells a root agent its extension reaches every workspace", () => {
  assertStringIncludes(defineExtTool(ROOT).description, "every workspace");
  assertStringIncludes(defineExtTool("ws-1").description, "only there");
});

Deno.test("define_extension records the rationale alongside the source for the reviewer", async () => {
  await withTempHome(async () => {
    await run(defineExtTool("ws-1"), {
      name: "lookup_weather",
      rationale: "user keeps asking\nabout the forecast",
      source: "export default function (pi) {}",
    });

    const src = await readLocalSource("ws-1", "lookup_weather", "pending");
    // Newlines flattened so the rationale cannot break out of its comment line.
    assertStringIncludes(src.split("\n")[0], "Rationale: user keeps asking about the forecast");
    assertStringIncludes(src, "export default function (pi) {}");
  });
});

Deno.test("define_extension rejects a name that would escape the pending dir", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => run(defineExtTool("ws-1"), { name: "../evil", rationale: "r", source: "x" }),
      Error,
      "invalid extension name",
    );
  });
});
