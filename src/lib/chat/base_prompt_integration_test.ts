// End-to-end check of the one thing pique does to pi's system prompt: a scope's
// agent/SYSTEM.md replaces pi's preamble, and root's reaches a workspace. pi discovers
// only the agentDir it is handed, so that inheritance exists only because
// scope/prompt.ts resolves the chain and startAgent passes the winner explicitly —
// nothing else in the suite covers it. Everything below goes through the real
// startAgent, the same path the desktop bindings call.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { startAgent, stopAgent, systemPromptOf } from "./agent.ts";
import { basePromptPath } from "../scope/prompt.ts";
import { ROOT, scopeAgentDir, type ScopeId } from "../scope/paths.ts";

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

// Start an agent, read something off it, and always tear it down.
async function withAgent<T>(
  opts: { scope?: ScopeId },
  read: (id: string) => T,
): Promise<T> {
  const id = await startAgent(opts);
  try {
    return read(id);
  } finally {
    stopAgent(id);
  }
}

Deno.test("with no SYSTEM.md anywhere, pi's own preamble stands", async () => {
  await withTempHome(async () => {
    const prompt = await withAgent({ scope: ROOT }, systemPromptOf);
    assertStringIncludes(prompt, "coding assistant operating inside pi");
  });
});

Deno.test("a scope SYSTEM.md replaces pi's preamble", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "SPIKE-BASE-PROMPT");

    const prompt = await withAgent({ scope: ROOT }, systemPromptOf);
    assertStringIncludes(prompt, "SPIKE-BASE-PROMPT");
    assertEquals(
      prompt.includes("coding assistant operating inside pi"),
      false,
      "the base prompt replaces pi's preamble",
    );
  });
});

Deno.test("a workspace inherits root's base prompt", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "SPIKE-BASE-PROMPT");

    const prompt = await withAgent({ scope: "ws-1" }, systemPromptOf);
    assertStringIncludes(prompt, "SPIKE-BASE-PROMPT");
  });
});
