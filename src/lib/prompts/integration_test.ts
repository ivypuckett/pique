// The claims this module's layout rests on, driven through the REAL DefaultResourceLoader
// that chat/agent.ts builds — pi is what actually decides which templates exist, so
// asserting our own service against itself would prove nothing.
//
// Three claims, all silent when violated: a saved template IS loaded, a quarantined one is
// NOT (pi's directory scan does not recurse, which is what makes prompts/pending safe to
// nest inside the dir pi reads), and ancestors' dirs load through
// additionalPromptTemplatePaths with the scope's own winning a name collision.
import { assertEquals } from "@std/assert";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { inheritedPromptDirs, savePrompt } from "./service.ts";
import { ensurePromptDirs, pendingPromptPath } from "./paths.ts";
import { ensureScopeDirs, ROOT, type ScopeId, scopeAgentDir } from "../scope/paths.ts";

async function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn(dir);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

// The same loader wiring startAgent uses, minus the prompt layers it does not affect.
// deno-lint-ignore no-explicit-any
async function loadFor(scope: ScopeId, cwd: string): Promise<any[]> {
  await ensureScopeDirs(scope);
  await ensurePromptDirs(scope);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: scopeAgentDir(scope),
    additionalPromptTemplatePaths: inheritedPromptDirs(scope),
  });
  await loader.reload();
  return [...loader.getPrompts().prompts];
}

Deno.test("a saved template is loaded by pi, and its hint survives the round trip", async () => {
  await withTempHome(async (home) => {
    await savePrompt("ws-1", "review", {
      description: "Review staged changes",
      argumentHint: "<focus>",
      body: "Review `git diff --cached`, focusing on $@",
    });

    const loaded = await loadFor("ws-1", home);
    assertEquals(loaded.map((t) => t.name), ["review"]);
    assertEquals(loaded[0].description, "Review staged changes");
    assertEquals(loaded[0].argumentHint, "<focus>");
  });
});

Deno.test("a quarantined template is invisible to pi", async () => {
  await withTempHome(async (home) => {
    await ensurePromptDirs("ws-1");
    await Deno.writeTextFile(
      pendingPromptPath("ws-1", "audit"),
      "---\ndescription: d\n---\nbody\n",
    );

    assertEquals(await loadFor("ws-1", home), []);
  });
});

Deno.test("root's templates reach a workspace, and the workspace's own shadow them", async () => {
  await withTempHome(async (home) => {
    await savePrompt(ROOT, "shared", { description: "root's only", body: "root body" });
    await savePrompt(ROOT, "review", { description: "root's review", body: "root body" });
    await savePrompt("ws-1", "review", { description: "the workspace's", body: "local body" });

    const loaded = await loadFor("ws-1", home);
    // pi's loader collapses a name collision itself, first path wins — so the `/` menu
    // needs no de-duplication of its own. What it does NOT decide for us is which copy
    // wins: that follows from the load order chat/agent.ts sets up (the scope's own
    // agentDir first, ancestors' dirs after), and the workspace's has to be the survivor.
    assertEquals(loaded.map((t) => t.name).sort(), ["review", "shared"]);
    assertEquals(loaded.find((t) => t.name === "review").description, "the workspace's");
  });
});

Deno.test("root sees only its own templates", async () => {
  await withTempHome(async (home) => {
    await savePrompt(ROOT, "shared", { description: "d", body: "b" });
    await savePrompt("ws-1", "local", { description: "d", body: "b" });

    assertEquals((await loadFor(ROOT, home)).map((t) => t.name), ["shared"]);
  });
});
