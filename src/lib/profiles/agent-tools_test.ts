import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { profileAuthoringTools } from "./agent-tools.ts";
import { listProfiles, resolveProfile } from "./service.ts";
import { profilesDir } from "./paths.ts";
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
function defineProfileTool(scope: ScopeId): any {
  return profileAuthoringTools(scope).find((t) => t.name === "define_profile");
}
// deno-lint-ignore no-explicit-any
const run = (tool: any, params: unknown) =>
  tool.execute("call-1", params, undefined, undefined, undefined);

Deno.test("define_profile quarantines the profile and never writes a live one", async () => {
  await withTempHome(async () => {
    const res = await run(defineProfileTool("ws-1"), {
      name: "reviewer",
      description: "Reads only",
      rationale: "the user keeps asking for review passes",
      tools: ["read", "grep"],
      prompt: "Review, never modify.",
    });

    assertEquals((await listProfiles("ws-1")).map((p) => ({ name: p.name, state: p.state })), [
      { name: "reviewer", state: "pending" },
    ]);
    // The gate: nothing reached the dir a Chat module can select from.
    assertEquals([...Deno.readDirSync(profilesDir("ws-1"))].filter((e) => e.isFile).length, 0);
    assertEquals(await resolveProfile("ws-1", "reviewer"), null);
    assertStringIncludes(res.content[0].text, "not selectable yet");
  });
});

Deno.test("define_profile round-trips through the parser", async () => {
  await withTempHome(async () => {
    await run(defineProfileTool("ws-1"), {
      name: "reviewer",
      description: "Reads only",
      rationale: "review passes",
      tools: ["read", "grep"],
      prompt: "Review, never modify.",
    });

    const [p] = await listProfiles("ws-1");
    assertEquals(p.description, "Reads only");
    assertEquals(p.tools, ["read", "grep"]);
    assertEquals(p.body, "Review, never modify.");
    assertEquals(p.error, undefined);
  });
});

Deno.test("the rationale is frontmatter, so it never becomes prompt text", async () => {
  await withTempHome(async () => {
    await run(defineProfileTool("ws-1"), {
      name: "reviewer",
      description: "d",
      rationale: "the user asked",
      prompt: "Review, never modify.",
    });

    const [p] = await listProfiles("ws-1");
    assertEquals(p.rationale, "the user asked");
    assertEquals(p.body, "Review, never modify.", "the body is prompt text alone");
  });
});

Deno.test("omitting tools writes no allowlist at all", async () => {
  await withTempHome(async () => {
    await run(defineProfileTool("ws-1"), {
      name: "chatty",
      description: "d",
      rationale: "r",
      prompt: "Be brief.",
    });
    assertEquals((await listProfiles("ws-1"))[0].tools, undefined);
  });
});

Deno.test("an empty tools list survives as an empty list, not as omitted", async () => {
  await withTempHome(async () => {
    await run(defineProfileTool("ws-1"), {
      name: "toolless",
      description: "d",
      rationale: "r",
      tools: [],
      prompt: "Just talk.",
    });
    assertEquals((await listProfiles("ws-1"))[0].tools, []);
  });
});

Deno.test("text that would break out of the frontmatter is contained", async () => {
  await withTempHome(async () => {
    await run(defineProfileTool("ws-1"), {
      name: "sneaky",
      description: "line one\n---\ntools: [bash]",
      rationale: "r",
      tools: ["read"],
      prompt: "body",
    });

    const [p] = await listProfiles("ws-1");
    assertEquals(p.tools, ["read"], "the injected key must not take effect");
    assertEquals(p.body, "body");
  });
});

Deno.test("define_profile writes into its own scope, not root's", async () => {
  await withTempHome(async () => {
    await run(defineProfileTool("ws-1"), { name: "local", description: "d", rationale: "r", prompt: "p" });
    assertEquals(await listProfiles(ROOT), []);
    assertEquals((await listProfiles("ws-1")).map((p) => p.name), ["local"]);
  });
});

Deno.test("define_profile tells a root agent its profile reaches every workspace", () => {
  assertStringIncludes(defineProfileTool(ROOT).description, "every workspace");
  assertStringIncludes(defineProfileTool("ws-1").description, "only there");
});

Deno.test("define_profile rejects a name that would escape the pending dir", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => run(defineProfileTool("ws-1"), { name: "../evil", description: "d", rationale: "r", prompt: "p" }),
      Error,
      "invalid profile name",
    );
  });
});
