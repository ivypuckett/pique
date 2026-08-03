import { assertEquals, assertRejects } from "@std/assert";
import {
  approvePrompt,
  deletePrompt,
  inheritedPromptDirs,
  listPrompts,
  listVisiblePrompts,
  rejectPrompt,
  savePrompt,
} from "./service.ts";
import { ensurePromptDirs, pendingPromptPath, promptPath, promptsDir } from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

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

async function write(
  scope: ScopeId,
  name: string,
  body: string,
  state: "live" | "pending" = "live",
): Promise<void> {
  await ensurePromptDirs(scope);
  const path = state === "live" ? promptPath(scope, name) : pendingPromptPath(scope, name);
  await Deno.writeTextFile(path, body);
}

Deno.test("a scope with no prompts dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listPrompts("ws-1"), []);
  });
});

Deno.test("live and pending templates are listed with their state", async () => {
  await withTempHome(async () => {
    await write("ws-1", "review", "---\ndescription: d\n---\nbody");
    await write("ws-1", "audit", "---\n---\nbody", "pending");

    assertEquals((await listPrompts("ws-1")).map((p) => ({ name: p.name, state: p.state })), [
      { name: "audit", state: "pending" },
      { name: "review", state: "live" },
    ]);
  });
});

// The dir is user-editable, so one stray file must not break the listing.
Deno.test("non-markdown files and illegal names are skipped", async () => {
  await withTempHome(async () => {
    await write("ws-1", "ok", "body");
    await Deno.writeTextFile(`${promptsDir("ws-1")}/notes.txt`, "x");
    await Deno.writeTextFile(`${promptsDir("ws-1")}/Bad Name.md`, "x");

    assertEquals((await listPrompts("ws-1")).map((p) => p.name), ["ok"]);
  });
});

Deno.test("saving writes a live template a chat can invoke straight away", async () => {
  await withTempHome(async () => {
    await savePrompt("ws-1", "ship", { description: "Ship it", argumentHint: "<pr>", body: "Merge $1" });

    const [p] = await listPrompts("ws-1");
    assertEquals(p.state, "live");
    assertEquals(p.description, "Ship it");
    assertEquals(p.argumentHint, "<pr>");
    assertEquals(p.body, "Merge $1");
  });
});

Deno.test("saving an existing name replaces it rather than adding a second", async () => {
  await withTempHome(async () => {
    await savePrompt("ws-1", "ship", { description: "one", body: "a" });
    await savePrompt("ws-1", "ship", { description: "two", body: "b" });

    const live = await listPrompts("ws-1");
    assertEquals(live.length, 1);
    assertEquals(live[0].description, "two");
  });
});

Deno.test("a name that could escape the scope is rejected before any write", async () => {
  await withTempHome(async () => {
    await assertRejects(() => savePrompt("ws-1", "../escape", { description: "d", body: "b" }));
  });
});

Deno.test("approving moves the template from quarantine to live", async () => {
  await withTempHome(async () => {
    await write("ws-1", "audit", "---\ndescription: d\n---\nbody", "pending");
    await approvePrompt("ws-1", "audit");

    assertEquals((await listPrompts("ws-1")).map((p) => ({ name: p.name, state: p.state })), [
      { name: "audit", state: "live" },
    ]);
  });
});

Deno.test("rejecting removes the quarantined file and touches nothing live", async () => {
  await withTempHome(async () => {
    await write("ws-1", "keep", "body");
    await write("ws-1", "audit", "body", "pending");
    await rejectPrompt("ws-1", "audit");

    assertEquals((await listPrompts("ws-1")).map((p) => p.name), ["keep"]);
  });
});

Deno.test("deleting removes the template from whichever dir it is in", async () => {
  await withTempHome(async () => {
    await write("ws-1", "live-one", "body");
    await write("ws-1", "pending-one", "body", "pending");
    await deletePrompt("ws-1", "live-one", "live");
    await deletePrompt("ws-1", "pending-one", "pending");

    assertEquals(await listPrompts("ws-1"), []);
  });
});

Deno.test("a workspace sees root's templates as well as its own", async () => {
  await withTempHome(async () => {
    await write(ROOT, "shared", "body");
    await write("ws-1", "local", "body");

    assertEquals((await listVisiblePrompts("ws-1")).map((p) => p.name).sort(), ["local", "shared"]);
    // Root can never see a workspace's.
    assertEquals((await listVisiblePrompts(ROOT)).map((p) => p.name), ["shared"]);
  });
});

// pi loads BOTH files and its expander takes the first match, so a duplicate name must
// collapse to ONE entry here — otherwise the `/` menu offers a twin that never runs.
Deno.test("a name defined in both scopes resolves once, to the nearest", async () => {
  await withTempHome(async () => {
    await write(ROOT, "review", "---\ndescription: root's\n---\nroot body");
    await write("ws-1", "review", "---\ndescription: the workspace's\n---\nlocal body");

    const visible = await listVisiblePrompts("ws-1");
    assertEquals(visible.length, 1);
    assertEquals(visible[0].description, "the workspace's");
    assertEquals(visible[0].scope, "ws-1");
  });
});

// Quarantined templates are not invocable, which is the whole point of the gate.
Deno.test("pending templates are never visible to a chat", async () => {
  await withTempHome(async () => {
    await write("ws-1", "audit", "body", "pending");
    assertEquals(await listVisiblePrompts("ws-1"), []);
  });
});

// Handed to pi as additionalPromptTemplatePaths. A scope's own dir must NOT be in the
// list — pi discovers that one from the agentDir, and repeating it loads everything twice.
Deno.test("only ancestors' dirs are passed to pi as extra paths", async () => {
  await withTempHome(async () => {
    assertEquals(inheritedPromptDirs(ROOT), []);
    assertEquals(inheritedPromptDirs("ws-1"), [promptsDir(ROOT)]);
    // …and the dir handed over is the one a root save actually writes into.
    await savePrompt(ROOT, "shared", { description: "d", body: "b" });
    const names = [...Deno.readDirSync(inheritedPromptDirs("ws-1")[0])].map((e) => e.name).sort();
    assertEquals(names, ["pending", "shared.md"]);
  });
});
