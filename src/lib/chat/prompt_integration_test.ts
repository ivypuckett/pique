// End-to-end check of what the `/` menu promises, through the real startAgent path — the
// same one the desktop bindings call. Three claims worth pinning here rather than in
// prompts/: an inherited template reaches a workspace agent, a quarantined one never does,
// and a template saved while a conversation is running becomes invocable without a restart.
import { assertEquals } from "@std/assert";
import { listCommands, reloadPrompts, startAgent, stopAgent } from "./agent.ts";
import { savePrompt } from "../prompts/service.ts";
import { ensurePromptDirs, pendingPromptPath } from "../prompts/paths.ts";
import { ROOT } from "../scope/paths.ts";

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

const promptsOf = (id: string) => listCommands(id).filter((c) => c.source === "prompt");

Deno.test("a workspace agent's menu holds its own templates and root's, with hints", async () => {
  await withTempHome(async () => {
    await savePrompt(ROOT, "shared", { description: "root's", argumentHint: "<x>", body: "b" });
    await savePrompt("ws-1", "local", { description: "the workspace's", body: "b" });

    const id = await startAgent({ scope: "ws-1" });
    try {
      const menu = promptsOf(id);
      assertEquals(menu.map((c) => c.name).sort(), ["local", "shared"]);
      assertEquals(menu.find((c) => c.name === "shared")?.argumentHint, "<x>");
      assertEquals(menu.find((c) => c.name === "local")?.description, "the workspace's");
    } finally {
      stopAgent(id);
    }
  });
});

// The gate define_prompt depends on: writing into pending puts nothing in the menu.
Deno.test("a quarantined template never reaches the menu", async () => {
  await withTempHome(async () => {
    await ensurePromptDirs("ws-1");
    await Deno.writeTextFile(pendingPromptPath("ws-1", "audit"), "---\ndescription: d\n---\nb\n");

    const id = await startAgent({ scope: "ws-1" });
    try {
      assertEquals(promptsOf(id), []);
    } finally {
      stopAgent(id);
    }
  });
});

// Why Settings can edit a template without confirming a restart the way the profile picker
// does: pi reads templates from the loader on every prompt, so refreshing the loader is
// enough. If this ever fails, the Settings copy about immediate effect is wrong too.
Deno.test("a template saved mid-conversation is invocable after a reload", async () => {
  await withTempHome(async () => {
    const id = await startAgent({ scope: "ws-1" });
    try {
      assertEquals(promptsOf(id), []);

      await savePrompt("ws-1", "later", { description: "written after the agent started", body: "b" });
      assertEquals(promptsOf(id), [], "must not appear before the loader is refreshed");

      await reloadPrompts(id);
      assertEquals(promptsOf(id).map((c) => c.name), ["later"]);
    } finally {
      stopAgent(id);
    }
  });
});

// Root sees only its own, the same rule the tool tree follows (scope_integration_test.ts).
Deno.test("a root agent's menu does not include a workspace's templates", async () => {
  await withTempHome(async () => {
    await savePrompt(ROOT, "shared", { description: "d", body: "b" });
    await savePrompt("ws-1", "local", { description: "d", body: "b" });

    const id = await startAgent({ scope: ROOT });
    try {
      assertEquals(promptsOf(id).map((c) => c.name), ["shared"]);
    } finally {
      stopAgent(id);
    }
  });
});
