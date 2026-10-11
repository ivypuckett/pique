// End-to-end check of what the `/` menu promises, through the real startAgent path — the
// same one the desktop bindings call. Two claims worth pinning here rather than in
// prompts/: a saved template reaches the agent, and a template saved while a conversation
// is running becomes invocable without a restart.
import { assertEquals } from "@std/assert";
import { listCommands, reloadPrompts, startAgent, stopAgent } from "./agent.ts";
import { savePrompt } from "../prompts/service.ts";

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

const promptsOf = (id: string) =>
  listCommands(id).filter((c) => c.source === "prompt");

Deno.test("the menu holds the saved templates, with their hints", async () => {
  await withTempHome(async () => {
    await savePrompt("shared", {
      description: "a template",
      argumentHint: "<x>",
      body: "b",
    });

    const id = await startAgent();
    try {
      const menu = promptsOf(id);
      assertEquals(menu.map((c) => c.name), ["shared"]);
      assertEquals(menu[0].argumentHint, "<x>");
      assertEquals(menu[0].description, "a template");
    } finally {
      stopAgent(id);
    }
  });
});

// Why the Library module can edit a template without restarting the conversation, unlike
// anything baked into the system prompt: pi reads templates from the loader on every
// prompt, so refreshing the loader is enough. If this ever fails, the Library's
// copy about immediate effect is wrong too.
Deno.test("a template saved mid-conversation is invocable after a reload", async () => {
  await withTempHome(async () => {
    const id = await startAgent();
    try {
      assertEquals(promptsOf(id), []);

      await savePrompt("later", {
        description: "written after the agent started",
        body: "b",
      });
      assertEquals(
        promptsOf(id),
        [],
        "must not appear before the loader is refreshed",
      );

      await reloadPrompts(id);
      assertEquals(promptsOf(id).map((c) => c.name), ["later"]);
    } finally {
      stopAgent(id);
    }
  });
});
