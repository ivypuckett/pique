// End-to-end check of the claim profiles exist to make: a chat agent started under a
// profile can call the tools that profile allows and NOT the ones it omits, and its
// system prompt is the scope's base plus the profile's body. Everything below goes
// through the real startAgent — the same path the desktop bindings call.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { activeToolNames, startAgent, stopAgent, systemPromptOf } from "./agent.ts";
import { ensureProfileDirs, profilePath } from "../profiles/paths.ts";
import { writeScopeConfig } from "../scope/config.ts";
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

async function writeProfile(scope: ScopeId, name: string, text: string): Promise<void> {
  await ensureProfileDirs(scope);
  await Deno.writeTextFile(profilePath(scope, name), text);
}

async function writeBasePrompt(scope: ScopeId, text: string): Promise<void> {
  await Deno.mkdir(scopeAgentDir(scope), { recursive: true });
  await Deno.writeTextFile(`${scopeAgentDir(scope)}/SYSTEM.md`, text);
}

// Start an agent, read something off it, and always tear it down.
async function withAgent<T>(
  opts: { scope?: ScopeId; profile?: string },
  read: (id: string) => T,
): Promise<T> {
  const id = await startAgent(opts);
  try {
    return read(id);
  } finally {
    stopAgent(id);
  }
}

Deno.test("a profile's allowlist restricts the agent's tools", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "reader", "---\ntools: [read, grep]\n---\nRead only.\n");

    const tools = await withAgent({ scope: ROOT, profile: "reader" }, activeToolNames);
    assertEquals(tools.includes("read"), true);
    assertEquals(tools.includes("grep"), true);
    assertEquals(tools.includes("bash"), false, "an excluded builtin must be gone");
    assertEquals(tools.includes("write"), false);
    assertEquals(tools.includes("define_extension"), false, "pique's own tools are filtered too");
    assertEquals(tools.includes("kanban_get_board"), false);
  });
});

Deno.test("no profile leaves today's tool set untouched", async () => {
  await withTempHome(async () => {
    const tools = await withAgent({ scope: ROOT }, activeToolNames);
    assertEquals(tools.includes("bash"), true);
    assertEquals(tools.includes("define_extension"), true);
    assertEquals(tools.includes("kanban_get_board"), true);
  });
});

Deno.test("a profile with no tools key does not restrict the tool set", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "chatty", "---\ndescription: d\n---\nBe brief.\n");
    const tools = await withAgent({ scope: ROOT, profile: "chatty" }, activeToolNames);
    assertEquals(tools.includes("bash"), true);
    assertEquals(tools.includes("define_extension"), true);
  });
});

Deno.test("tools: [] yields an agent with no tools at all", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "toolless", "---\ntools: []\n---\nJust talk.\n");
    assertEquals(await withAgent({ scope: ROOT, profile: "toolless" }, activeToolNames), []);
  });
});

Deno.test("a profile body is appended to pi's prompt, not substituted for it", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "reader", "---\ntools: [read]\n---\nSPIKE-PROFILE-BODY\n");

    const prompt = await withAgent({ scope: ROOT, profile: "reader" }, systemPromptOf);
    assertStringIncludes(prompt, "SPIKE-PROFILE-BODY");
    assertStringIncludes(prompt, "coding assistant operating inside pi");
  });
});

Deno.test("a scope SYSTEM.md replaces the preamble, and the body still appends", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "SPIKE-BASE-PROMPT");
    await writeProfile(ROOT, "reader", "---\ntools: [read]\n---\nSPIKE-PROFILE-BODY\n");

    const prompt = await withAgent({ scope: ROOT, profile: "reader" }, systemPromptOf);
    assertStringIncludes(prompt, "SPIKE-BASE-PROMPT");
    assertStringIncludes(prompt, "SPIKE-PROFILE-BODY");
    assertEquals(
      prompt.includes("coding assistant operating inside pi"),
      false,
      "the base prompt replaces pi's preamble",
    );
  });
});

Deno.test("a workspace inherits root's profiles and root's base prompt", async () => {
  await withTempHome(async () => {
    await writeBasePrompt(ROOT, "SPIKE-BASE-PROMPT");
    await writeProfile(ROOT, "reader", "---\ntools: [read]\n---\nSPIKE-PROFILE-BODY\n");

    const id = await startAgent({ scope: "ws-1", profile: "reader" });
    try {
      assertEquals(activeToolNames(id).includes("bash"), false);
      assertStringIncludes(systemPromptOf(id), "SPIKE-BASE-PROMPT");
      assertStringIncludes(systemPromptOf(id), "SPIKE-PROFILE-BODY");
    } finally {
      stopAgent(id);
    }
  });
});

Deno.test("a workspace profile shadows root's of the same name", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "reader", "---\ntools: [read]\n---\nROOT-BODY\n");
    await writeProfile("ws-1", "reader", "---\ntools: [read, bash]\n---\nWORKSPACE-BODY\n");

    const id = await startAgent({ scope: "ws-1", profile: "reader" });
    try {
      assertEquals(activeToolNames(id).includes("bash"), true);
      assertStringIncludes(systemPromptOf(id), "WORKSPACE-BODY");
    } finally {
      stopAgent(id);
    }
  });
});

Deno.test("a missing profile falls back to no profile rather than failing", async () => {
  await withTempHome(async () => {
    const tools = await withAgent({ scope: ROOT, profile: "ghost" }, activeToolNames);
    assertEquals(tools.includes("bash"), true, "a stale profile name must not disarm the agent");
  });
});

Deno.test("the scope default applies when no profile is passed", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "reader", "---\ntools: [read]\n---\nbody\n");
    await writeScopeConfig(ROOT, { chat: { defaultProfile: "reader" } });

    assertEquals((await withAgent({ scope: ROOT }, activeToolNames)).includes("bash"), false);
  });
});

Deno.test("an explicit empty profile overrides the scope default", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "reader", "---\ntools: [read]\n---\nbody\n");
    await writeScopeConfig(ROOT, { chat: { defaultProfile: "reader" } });

    // "" is the picker's "base" — it must not fall through to the scope default.
    const tools = await withAgent({ scope: ROOT, profile: "" }, activeToolNames);
    assertEquals(tools.includes("bash"), true);
  });
});

Deno.test("a workspace inherits root's default profile", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "reader", "---\ntools: [read]\n---\nbody\n");
    await writeScopeConfig(ROOT, { chat: { defaultProfile: "reader" } });

    assertEquals((await withAgent({ scope: "ws-1" }, activeToolNames)).includes("bash"), false);
  });
});
