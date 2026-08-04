import { assertEquals, assertRejects } from "@std/assert";
import {
  BUILTIN_GROUPS,
  resolveExtensionRefs,
  resolveSkillRefs,
} from "./resolve.ts";
import {
  ensureExtensionDirs,
  livePath,
  pendingPath,
} from "../extensions/paths.ts";
import { skillsDir } from "../skills/paths.ts";
import type { ScopeId } from "../scope/paths.ts";

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

async function writeExt(
  scope: ScopeId,
  name: string,
  state: "enabled" | "pending" = "enabled",
): Promise<void> {
  await ensureExtensionDirs(scope);
  const path = state === "enabled"
    ? livePath(scope, name)
    : pendingPath(scope, name);
  await Deno.writeTextFile(path, "export default () => {};\n");
}

async function writeSkill(scope: ScopeId, name: string): Promise<void> {
  await Deno.mkdir(`${skillsDir(scope)}/${name}`, { recursive: true });
  await Deno.writeTextFile(
    `${skillsDir(scope)}/${name}/SKILL.md`,
    "---\n---\nb",
  );
}

Deno.test("the three pique: groups resolve to tool definitions, not paths", async () => {
  await withTempHome(async () => {
    const r = await resolveExtensionRefs("ws-1", [
      "pique:kanban",
      "pique:extension-authoring",
      "pique:prompt-authoring",
    ]);
    assertEquals(r.extensionPaths, []);
    // Each group contributes at least one tool; the exact count is the groups' business.
    assertEquals(r.customTools.length > 0, true);
    assertEquals(Object.keys(BUILTIN_GROUPS).sort(), [
      "extension-authoring",
      "kanban",
      "prompt-authoring",
    ]);
  });
});

Deno.test("an unknown pique: group raises", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["pique:nope"]),
      Error,
      "pique:nope",
    );
  });
});

Deno.test("a local extension name resolves to its live file path", async () => {
  await withTempHome(async () => {
    await writeExt("ws-1", "kanban_notes");

    const r = await resolveExtensionRefs("ws-1", ["kanban_notes"]);
    assertEquals(r.extensionPaths, [livePath("ws-1", "kanban_notes")]);
  });
});

Deno.test("a local extension is inherited from root and the nearest scope wins", async () => {
  await withTempHome(async () => {
    await writeExt("root", "shared");
    assertEquals(
      (await resolveExtensionRefs("ws-1", ["shared"])).extensionPaths,
      [livePath("root", "shared")],
    );

    await writeExt("ws-1", "shared");
    assertEquals(
      (await resolveExtensionRefs("ws-1", ["shared"])).extensionPaths,
      [livePath("ws-1", "shared")],
    );
  });
});

// The review gate: quarantined code is not nameable, so an automaton cannot run an
// extension a human has not enabled.
Deno.test("a pending extension is not nameable", async () => {
  await withTempHome(async () => {
    await writeExt("ws-1", "unreviewed", "pending");

    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["unreviewed"]),
      Error,
      "unreviewed",
    );
  });
});

Deno.test("an unresolvable name raises rather than being skipped", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["nope"]),
      Error,
      "nope",
    );
  });
});

// Without this an automaton file naming npm:anything would make pi fetch and load
// unreviewed code, bypassing Library → Extensions entirely.
Deno.test("a package source that is not enabled in the scope raises", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["npm:pi-crew"]),
      Error,
      "npm:pi-crew",
    );
  });
});

Deno.test("skills resolve to paths and an unknown one raises", async () => {
  await withTempHome(async () => {
    await writeSkill("root", "changelog-style");

    assertEquals(await resolveSkillRefs("ws-1", ["changelog-style"]), [
      `${skillsDir("root")}/changelog-style`,
    ]);
    await assertRejects(
      () => resolveSkillRefs("ws-1", ["nope"]),
      Error,
      "nope",
    );
  });
});

Deno.test("empty ref lists resolve to empty, which is a real capability set", async () => {
  await withTempHome(async () => {
    const r = await resolveExtensionRefs("ws-1", []);
    assertEquals(r.extensionPaths, []);
    assertEquals(r.customTools, []);
    assertEquals(await resolveSkillRefs("ws-1", []), []);
  });
});
