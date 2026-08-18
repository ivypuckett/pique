import { assertEquals } from "@std/assert";
import { basePromptPath, resolveBasePrompt } from "./prompt.ts";
import { ROOT, scopeAgentDir, type ScopeId } from "./paths.ts";

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

async function writeBasePrompt(scope: ScopeId, text: string): Promise<void> {
  await Deno.mkdir(scopeAgentDir(scope), { recursive: true });
  await Deno.writeTextFile(basePromptPath(scope), text);
}

Deno.test("the base prompt uses pi's own filename inside the agent dir", () => {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", "/home/x");
  try {
    assertEquals(
      basePromptPath(ROOT),
      "/home/x/.pique/scopes/root/agent/SYSTEM.md",
    );
    assertEquals(
      basePromptPath("ws-2"),
      "/home/x/.pique/scopes/ws-2/agent/SYSTEM.md",
    );
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
});

Deno.test("the base prompt is the nearest SYSTEM.md on the chain", async () => {
  await withTempHome(async () => {
    // Undefined, not "": chat/agent.ts hands this straight to pi, and undefined is what
    // leaves pi's own preamble in place.
    assertEquals(resolveBasePrompt("ws-1"), undefined);

    await writeBasePrompt(ROOT, "root base");
    assertEquals(
      resolveBasePrompt("ws-1"),
      "root base",
      "root's reaches a workspace",
    );
    assertEquals(resolveBasePrompt(ROOT), "root base");

    await writeBasePrompt("ws-1", "workspace base");
    assertEquals(
      resolveBasePrompt("ws-1"),
      "workspace base",
      "the nearest one wins",
    );
    assertEquals(
      resolveBasePrompt(ROOT),
      "root base",
      "root is unaffected",
    );
  });
});
