// End-to-end check of the one thing pique does to pi's system prompt: a scope's
// agent/SYSTEM.md replaces pi's preamble, and root's reaches a workspace. pi discovers
// only the agentDir it is handed, so that inheritance exists only because
// scope/prompt.ts resolves the chain and startAgent passes the winner explicitly —
// nothing else in the suite covers it. Everything below goes through the real
// startAgent, the same path the desktop bindings call.
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  reloadAgent,
  reloadPrompts,
  startAgent,
  stopAgent,
  systemPromptOf,
} from "./agent.ts";
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

// The prompt reaching a RUNNING conversation, which is the reason startAgent hands pi a
// callback rather than the resolved text. docs/extensions.md recorded the opposite —
// that an edit needs a new module because "pi exposes no setter" — and the setter is
// indeed absent; what makes this work is that pi rebuilds the prompt from its resource
// loader inside reload(), so a loader that re-resolves is enough. Each case below fails
// against a captured string, and the third and fourth fail against a captured path too.
Deno.test("an edited SYSTEM.md reaches a running conversation on reload", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "PROMPT-BEFORE");
    const id = await startAgent({ scope: ROOT });
    try {
      assertStringIncludes(systemPromptOf(id), "PROMPT-BEFORE");

      await writeBasePrompt(ROOT, "PROMPT-AFTER");
      const summary = await reloadAgent(id);

      assertStringIncludes(systemPromptOf(id), "PROMPT-AFTER");
      assertEquals(
        systemPromptOf(id).includes("PROMPT-BEFORE"),
        false,
        "the old prompt is replaced, not appended to",
      );
      assertEquals(summary.promptChanged, true);
    } finally {
      stopAgent(id);
    }
  });
});

Deno.test("a reload with no SYSTEM.md edit reports no prompt change", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "PROMPT-STEADY");
    const id = await startAgent({ scope: ROOT });
    try {
      const summary = await reloadAgent(id);
      assertEquals(
        summary.promptChanged,
        false,
        "re-reading the same file is not a change to report",
      );
      assertStringIncludes(systemPromptOf(id), "PROMPT-STEADY");
    } finally {
      stopAgent(id);
    }
  });
});

// reloadAgent reports promptChanged by comparing against the prompt it recorded, which is
// only sound while nothing ELSE moves the session's prompt. Library editing a template
// calls reloadPrompts — the loader alone — and pi rebuilds the prompt from the loader in
// session.reload() rather than there, so the recorded value stays accurate. Pinned
// because it is pi's internal wiring, not a promise pique controls.
Deno.test("reloadPrompts leaves the running system prompt where it was", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "PROMPT-A");
    const id = await startAgent({ scope: ROOT });
    try {
      await writeBasePrompt(ROOT, "PROMPT-B");
      await reloadPrompts(id);

      assertStringIncludes(systemPromptOf(id), "PROMPT-A");
      assertEquals(systemPromptOf(id).includes("PROMPT-B"), false);
      // …and the deferred edit still lands once a real reload runs.
      assertEquals((await reloadAgent(id)).promptChanged, true);
      assertStringIncludes(systemPromptOf(id), "PROMPT-B");
    } finally {
      stopAgent(id);
    }
  });
});

Deno.test("a workspace SYSTEM.md written later shadows root's on reload", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "ROOT-PROMPT");
    const id = await startAgent({ scope: "ws-1" });
    try {
      assertStringIncludes(systemPromptOf(id), "ROOT-PROMPT");

      // Not an edit to the file the session resolved to, but a NEW file that now wins
      // the chain — so the whole resolution has to re-run, not just the winner re-read.
      await writeBasePrompt("ws-1", "WORKSPACE-PROMPT");
      assertEquals((await reloadAgent(id)).promptChanged, true);

      assertStringIncludes(systemPromptOf(id), "WORKSPACE-PROMPT");
      assertEquals(systemPromptOf(id).includes("ROOT-PROMPT"), false);
    } finally {
      stopAgent(id);
    }
  });
});

Deno.test("a deleted SYSTEM.md falls back on reload rather than sticking", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "ROOT-PROMPT");
    await writeBasePrompt("ws-1", "WORKSPACE-PROMPT");
    const id = await startAgent({ scope: "ws-1" });
    try {
      assertStringIncludes(systemPromptOf(id), "WORKSPACE-PROMPT");

      await Deno.remove(basePromptPath("ws-1"));
      assertEquals((await reloadAgent(id)).promptChanged, true);

      assertStringIncludes(systemPromptOf(id), "ROOT-PROMPT");

      // And with nothing left on the chain, pi's own preamble comes back — the
      // undefined-must-stay-undefined case, now on the reload path too.
      await Deno.remove(basePromptPath(ROOT));
      assertEquals((await reloadAgent(id)).promptChanged, true);
      assertStringIncludes(
        systemPromptOf(id),
        "coding assistant operating inside pi",
      );
    } finally {
      stopAgent(id);
    }
  });
});
