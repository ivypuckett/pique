// End-to-end check of the two prompt files in pi's agent dir: SYSTEM.md replaces pi's
// preamble, APPEND_SYSTEM.md is added on top of whichever base applies, and an edit to
// either reaches a running conversation on `/reload`. pi discovers both itself; what
// this pins is that pique's startAgent leaves that discovery intact and that reloadAgent
// reports the change. Everything below goes through the real startAgent, the same path
// the desktop bindings call.
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  reloadAgent,
  reloadPrompts,
  startAgent,
  stopAgent,
  systemPromptOf,
} from "./agent.ts";
import { promptFilePath, type PromptFileKind } from "../prompts/system.ts";
import { agentDir } from "../paths.ts";

const PI_PREAMBLE = "coding assistant operating inside pi";

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

async function write(kind: PromptFileKind, text: string): Promise<void> {
  await Deno.mkdir(agentDir(), { recursive: true });
  await Deno.writeTextFile(promptFilePath(kind), text);
}

// Start an agent, read something off it, and always tear it down.
async function withAgent<T>(read: (id: string) => T): Promise<T> {
  const id = await startAgent();
  try {
    return read(id);
  } finally {
    stopAgent(id);
  }
}

Deno.test("with no SYSTEM.md, pi's own preamble stands", async () => {
  await withTempHome(async () => {
    assertStringIncludes(await withAgent(systemPromptOf), PI_PREAMBLE);
  });
});

Deno.test("a SYSTEM.md replaces pi's preamble", async () => {
  await withTempHome(async () => {
    await write("system", "SPIKE-BASE-PROMPT");

    const prompt = await withAgent(systemPromptOf);
    assertStringIncludes(prompt, "SPIKE-BASE-PROMPT");
    assertEquals(
      prompt.includes(PI_PREAMBLE),
      false,
      "the base prompt replaces pi's preamble",
    );
  });
});

// pi rebuilds the prompt from its resource loader inside reload(), so an edit reaches a
// running conversation without a new one.
Deno.test("an edited SYSTEM.md reaches a running conversation on reload", async () => {
  await withTempHome(async () => {
    await write("system", "PROMPT-BEFORE");
    const id = await startAgent();
    try {
      assertStringIncludes(systemPromptOf(id), "PROMPT-BEFORE");

      await write("system", "PROMPT-AFTER");
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

Deno.test("a reload with no edit reports no prompt change", async () => {
  await withTempHome(async () => {
    await write("system", "PROMPT-STEADY");
    const id = await startAgent();
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

// reloadAgent reports promptChanged by comparing against the files it recorded, which is
// only sound while nothing ELSE moves the session's prompt. Library editing a template
// calls reloadPrompts — the loader alone — and pi rebuilds the prompt from the loader in
// session.reload() rather than there, so the recorded value stays accurate. Pinned
// because it is pi's internal wiring, not a promise pique controls.
Deno.test("reloadPrompts leaves the running system prompt where it was", async () => {
  await withTempHome(async () => {
    await write("system", "PROMPT-A");
    const id = await startAgent();
    try {
      await write("system", "PROMPT-B");
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

Deno.test("a deleted SYSTEM.md falls back to pi's preamble on reload", async () => {
  await withTempHome(async () => {
    await write("system", "MY-PROMPT");
    const id = await startAgent();
    try {
      assertStringIncludes(systemPromptOf(id), "MY-PROMPT");

      await Deno.remove(promptFilePath("system"));
      assertEquals((await reloadAgent(id)).promptChanged, true);
      assertStringIncludes(systemPromptOf(id), PI_PREAMBLE);
    } finally {
      stopAgent(id);
    }
  });
});

// House rules can apply WITHOUT anyone having to replace pi's preamble first.
Deno.test("the appendix lands on top of pi's own preamble", async () => {
  await withTempHome(async () => {
    await write("appendix", "APPENDIX-ONLY");

    const prompt = await withAgent(systemPromptOf);
    assertStringIncludes(prompt, PI_PREAMBLE);
    assertStringIncludes(prompt, "APPENDIX-ONLY");
  });
});

Deno.test("the appendix lands on top of a SYSTEM.md too", async () => {
  await withTempHome(async () => {
    await write("system", "SPIKE-BASE-PROMPT");
    await write("appendix", "SPIKE-APPENDIX");

    const prompt = await withAgent(systemPromptOf);
    assertStringIncludes(prompt, "SPIKE-BASE-PROMPT");
    assertStringIncludes(prompt, "SPIKE-APPENDIX");
    assertEquals(
      prompt.indexOf("SPIKE-BASE-PROMPT") < prompt.indexOf("SPIKE-APPENDIX"),
      true,
      "the appendix comes after the base it is appended to",
    );
  });
});

Deno.test("an appendix added later is reported and applied on reload, and removed again", async () => {
  await withTempHome(async () => {
    const id = await startAgent();
    try {
      assertEquals(systemPromptOf(id).includes("HOUSE-RULES"), false);

      await write("appendix", "HOUSE-RULES");
      assertEquals((await reloadAgent(id)).promptChanged, true);
      assertStringIncludes(systemPromptOf(id), "HOUSE-RULES");

      await Deno.remove(promptFilePath("appendix"));
      assertEquals((await reloadAgent(id)).promptChanged, true);
      assertEquals(systemPromptOf(id).includes("HOUSE-RULES"), false);
    } finally {
      stopAgent(id);
    }
  });
});
