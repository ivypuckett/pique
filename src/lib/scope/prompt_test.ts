import { assertEquals } from "@std/assert";
import {
  appendPromptPath,
  basePromptPath,
  deletePromptFile,
  listPromptFiles,
  resolveAppendPrompts,
  resolveBasePrompt,
  savePromptFile,
} from "./prompt.ts";
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

async function writeAppendPrompt(scope: ScopeId, text: string): Promise<void> {
  await Deno.mkdir(scopeAgentDir(scope), { recursive: true });
  await Deno.writeTextFile(appendPromptPath(scope), text);
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

Deno.test("the appendix uses pi's own filename inside the agent dir", () => {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", "/home/x");
  try {
    assertEquals(
      appendPromptPath(ROOT),
      "/home/x/.pique/scopes/root/agent/APPEND_SYSTEM.md",
    );
    assertEquals(
      appendPromptPath("ws-2"),
      "/home/x/.pique/scopes/ws-2/agent/APPEND_SYSTEM.md",
    );
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
});

// The opposite rule to the base prompt, and the reason the two are separate files: root
// holds house rules, the workspace adds its archetype, and BOTH apply. A test that
// asserted only the workspace's would pass against nearest-wins too, so each case below
// names what it would catch.
Deno.test("the appendix concatenates down the chain, root first", async () => {
  await withTempHome(async () => {
    assertEquals(resolveAppendPrompts("ws-1"), [], "none anywhere is empty");

    await writeAppendPrompt(ROOT, "house rules");
    assertEquals(
      resolveAppendPrompts("ws-1"),
      ["house rules"],
      "root's reaches a workspace",
    );

    await writeAppendPrompt("ws-1", "swift archetype");
    assertEquals(
      resolveAppendPrompts("ws-1"),
      ["house rules", "swift archetype"],
      "both apply, root's first — this is what nearest-wins would fail",
    );
    assertEquals(
      resolveAppendPrompts(ROOT),
      ["house rules"],
      "root never sees a workspace's",
    );

    // Two workspaces are the motivating case: neither sees the other's archetype.
    await writeAppendPrompt("ws-2", "go archetype");
    assertEquals(resolveAppendPrompts("ws-2"), ["house rules", "go archetype"]);
    assertEquals(resolveAppendPrompts("ws-1"), ["house rules", "swift archetype"]);
  });
});

Deno.test("a whitespace-only appendix contributes nothing", async () => {
  await withTempHome(async () => {
    await writeAppendPrompt(ROOT, "house rules");
    await writeAppendPrompt("ws-1", "\n  \n");
    // pi joins these with a blank line, so an entry of blanks would show up as trailing
    // whitespace on the assembled prompt rather than as nothing.
    assertEquals(resolveAppendPrompts("ws-1"), ["house rules"]);
  });
});

Deno.test("listPromptFiles reports both files, present or not", async () => {
  await withTempHome(async () => {
    const empty = await listPromptFiles("ws-1");
    assertEquals(empty.map((f) => f.kind), ["system", "appendix"]);
    assertEquals(
      empty.map((f) => f.body),
      [undefined, undefined],
      "absent is undefined, not \"\" — the Library renders the difference",
    );
    assertEquals(empty[0].path, basePromptPath("ws-1"));
    assertEquals(empty[1].path, appendPromptPath("ws-1"));

    await writeAppendPrompt("ws-1", "swift archetype");
    const one = await listPromptFiles("ws-1");
    assertEquals(one[0].body, undefined);
    assertEquals(one[1].body, "swift archetype");
  });
});

Deno.test("saving creates the scope's dirs and reaches the resolvers", async () => {
  await withTempHome(async () => {
    // No mkdir first: a workspace that has never been written to has no directory at
    // all, and saving is one of the things that materializes it.
    await savePromptFile("ws-1", "system", "workspace base");
    await savePromptFile("ws-1", "appendix", "swift archetype");
    assertEquals(resolveBasePrompt("ws-1"), "workspace base");
    assertEquals(resolveAppendPrompts("ws-1"), ["swift archetype"]);
  });
});

Deno.test("saving an empty body deletes the file rather than emptying it", async () => {
  await withTempHome(async () => {
    await savePromptFile(ROOT, "system", "root base");
    await savePromptFile("ws-1", "system", "workspace base");

    // The case this rule exists for: an empty workspace SYSTEM.md would still shadow
    // root's on the chain and then resolve to "", so root's would silently stop
    // applying. Deleting it hands the chain back.
    await savePromptFile("ws-1", "system", "   \n ");
    assertEquals((await listPromptFiles("ws-1"))[0].body, undefined);
    assertEquals(resolveBasePrompt("ws-1"), "root base");
  });
});

Deno.test("deleting a file that is not there is not an error", async () => {
  await withTempHome(async () => {
    await deletePromptFile("ws-1", "system");
    await deletePromptFile("ws-1", "appendix");
    assertEquals(resolveBasePrompt("ws-1"), undefined);
  });
});
