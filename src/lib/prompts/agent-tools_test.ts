import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { promptAuthoringTools } from "./agent-tools.ts";
import { listPrompts, listVisiblePrompts } from "./service.ts";
import { promptsDir } from "./paths.ts";
import type { ScopeId } from "../scope/paths.ts";

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
function definePromptTool(scope: ScopeId): any {
  return promptAuthoringTools(scope).find((t) => t.name === "define_prompt");
}
// deno-lint-ignore no-explicit-any
const run = (tool: any, params: unknown) =>
  tool.execute("call-1", params, undefined, undefined, undefined);

Deno.test("define_prompt quarantines the template and never writes a live one", async () => {
  await withTempHome(async () => {
    const res = await run(definePromptTool("ws-1"), {
      name: "review-staged",
      description: "Review staged changes",
      rationale: "the user keeps asking for this by hand",
      body: "Review `git diff --cached`, focusing on $@",
      argumentHint: "<focus>",
    });

    assertEquals(
      (await listPrompts("ws-1")).map((p) => ({
        name: p.name,
        state: p.state,
      })),
      [
        { name: "review-staged", state: "pending" },
      ],
    );
    // The gate: nothing reached the dir pi loads from, so `/review-staged` does not exist.
    assertEquals(
      [...Deno.readDirSync(promptsDir("ws-1"))].filter((e) => e.isFile).length,
      0,
    );
    assertEquals(await listVisiblePrompts("ws-1"), []);
    assertStringIncludes(res.content[0].text, "not invocable yet");
  });
});

Deno.test("define_prompt round-trips through the parser", async () => {
  await withTempHome(async () => {
    await run(definePromptTool("ws-1"), {
      name: "ship",
      description: "Ship a PR",
      rationale: "repeated request",
      body: "Merge $1 once CI is green",
      argumentHint: "<pr>",
    });

    const [p] = await listPrompts("ws-1");
    assertEquals(p.description, "Ship a PR");
    assertEquals(p.argumentHint, "<pr>");
    assertEquals(p.rationale, "repeated request");
    assertEquals(p.body, "Merge $1 once CI is green");
  });
});

Deno.test("define_prompt rejects a name that could escape the scope", async () => {
  await withTempHome(async () => {
    await assertRejects(() =>
      run(definePromptTool("ws-1"), {
        name: "../escape",
        description: "d",
        rationale: "r",
        body: "b",
      })
    );
  });
});

// The agent should know how far its template will reach before it writes one.
Deno.test("the tool description says how far an approved template reaches", () => {
  assertStringIncludes(definePromptTool("root").description, "every workspace");
  assertStringIncludes(definePromptTool("ws-1").description, "only there");
});
