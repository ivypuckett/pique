// The claim this module's layout rests on, driven through the REAL DefaultResourceLoader
// that chat/agent.ts builds — pi is what actually decides which templates exist, so
// asserting our own service against itself would prove nothing.
import { assertEquals } from "@std/assert";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { savePrompt } from "./service.ts";
import { agentDir } from "../paths.ts";

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
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

Deno.test("a saved template is loaded by pi, and its hint survives the round trip", async () => {
  await withTempHome(async (home) => {
    await savePrompt("review", {
      description: "Review staged changes",
      argumentHint: "<focus>",
      body: "Review `git diff --cached`, focusing on $@",
    });

    const loader = new DefaultResourceLoader({ cwd: home, agentDir: agentDir() });
    await loader.reload();
    const loaded = [...loader.getPrompts().prompts];
    assertEquals(loaded.map((t) => t.name), ["review"]);
    assertEquals(loaded[0].description, "Review staged changes");
    assertEquals(loaded[0].argumentHint, "<focus>");
  });
});
