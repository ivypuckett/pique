import { assertEquals, assertRejects } from "@std/assert";
import { readJson, resolveGitScanDepth, resolveModuleDir, resolveWorkspaceDir, writeJson } from "./file.ts";

// Each test runs against a throwaway HOME so it exercises real disk I/O without
// touching the developer's own ~/.pique.
async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const tmp = await Deno.makeTempDir();
  Deno.env.set("HOME", tmp);
  try {
    await fn();
  } finally {
    if (prev !== undefined) Deno.env.set("HOME", prev);
    else Deno.env.delete("HOME");
    await Deno.remove(tmp, { recursive: true });
  }
}

Deno.test("readJson returns null when the file is absent", async () => {
  await withTempHome(async () => {
    assertEquals(await readJson("settings"), null);
  });
});

Deno.test("writeJson then readJson round-trips", async () => {
  await withTempHome(async () => {
    await writeJson("settings", { a: 1, nested: { b: true } });
    assertEquals(await readJson("settings"), { a: 1, nested: { b: true } });
  });
});

Deno.test("writeJson creates ~/.pique when missing", async () => {
  await withTempHome(async () => {
    await writeJson("layout", { x: true });
    const stat = await Deno.stat(`${Deno.env.get("HOME")}/.pique`);
    assertEquals(stat.isDirectory, true);
  });
});

Deno.test("readJson returns null on corrupt json", async () => {
  await withTempHome(async () => {
    await Deno.mkdir(`${Deno.env.get("HOME")}/.pique`, { recursive: true });
    await Deno.writeTextFile(`${Deno.env.get("HOME")}/.pique/settings.json`, "{ not json");
    assertEquals(await readJson("settings"), null);
  });
});

Deno.test("writeJson rejects names with path separators", async () => {
  await withTempHome(async () => {
    await assertRejects(() => writeJson("../evil", {}));
  });
});

// Both resolvers read the LAYOUT tree now: the fallback directory is the root
// workspace's cwd, which is what the old global workspace.defaultDir became.
const layout = (cwd: unknown) => ({ root: { cwd } } as Parameters<typeof resolveWorkspaceDir>[0]);

Deno.test("resolveWorkspaceDir returns root's cwd when it is a non-empty string", () => {
  assertEquals(resolveWorkspaceDir(layout("/proj/x")), "/proj/x");
});

Deno.test("resolveWorkspaceDir falls back to $HOME for unset/blank/non-string", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveWorkspaceDir(null), home);
  assertEquals(resolveWorkspaceDir({}), home);
  assertEquals(resolveWorkspaceDir({ root: {} }), home);
  assertEquals(resolveWorkspaceDir(layout("")), home);
  assertEquals(resolveWorkspaceDir(layout("   ")), home);
  assertEquals(resolveWorkspaceDir(layout(42)), home);
  // A pre-root layout has no root workspace at all.
  assertEquals(resolveWorkspaceDir({ workspaces: [], activeId: "ws-1" }), home);
});

Deno.test("resolveWorkspaceDir expands a leading ~", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveWorkspaceDir(layout("~")), home);
  assertEquals(resolveWorkspaceDir(layout("~/proj/x")), `${home}/proj/x`);
  assertEquals(resolveWorkspaceDir(layout("  ~/proj  ")), `${home}/proj`);
});

Deno.test("resolveWorkspaceDir leaves a non-leading or ~user tilde untouched", () => {
  assertEquals(resolveWorkspaceDir(layout("~alice")), "~alice");
  assertEquals(resolveWorkspaceDir(layout("/a/~b")), "/a/~b");
});

Deno.test("resolveModuleDir uses the override when set, expanding a leading ~", () => {
  const home = Deno.env.get("HOME");
  // A workspace's own cwd wins over root's, whatever root holds.
  assertEquals(resolveModuleDir("/proj/y", layout("/proj/x")), "/proj/y");
  assertEquals(resolveModuleDir("~/work", layout("/proj/x")), `${home}/work`);
});

Deno.test("resolveModuleDir inherits root's cwd for a blank/absent override", () => {
  assertEquals(resolveModuleDir(undefined, layout("/proj/x")), "/proj/x");
  assertEquals(resolveModuleDir("", layout("/proj/x")), "/proj/x");
  assertEquals(resolveModuleDir("   ", layout("/proj/x")), "/proj/x");
  // No override and no root cwd → $HOME, same as resolveWorkspaceDir.
  assertEquals(resolveModuleDir(undefined, null), Deno.env.get("HOME"));
});

Deno.test("resolveGitScanDepth reads a valid configured depth, clamped to 10", () => {
  assertEquals(resolveGitScanDepth({ workspace: { gitScanDepth: 0 } }), 0);
  assertEquals(resolveGitScanDepth({ workspace: { gitScanDepth: 5 } }), 5);
  assertEquals(resolveGitScanDepth({ workspace: { gitScanDepth: 99 } }), 10);
});

Deno.test("resolveGitScanDepth falls back to 3 for missing/invalid values", () => {
  assertEquals(resolveGitScanDepth(null), 3);
  assertEquals(resolveGitScanDepth({}), 3);
  assertEquals(resolveGitScanDepth({ workspace: {} }), 3);
  assertEquals(resolveGitScanDepth({ workspace: { gitScanDepth: -1 } }), 3);
  assertEquals(resolveGitScanDepth({ workspace: { gitScanDepth: 2.5 } }), 3);
  // deno-lint-ignore no-explicit-any
  assertEquals(resolveGitScanDepth({ workspace: { gitScanDepth: "4" as any } }), 3);
});
