import { assertEquals, assertRejects } from "@std/assert";
import { readJson, resolveModuleDir, resolveWorkspaceDir, writeJson } from "./file.ts";

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

Deno.test("resolveWorkspaceDir returns defaultDir when it is a non-empty string", () => {
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "/proj/x" } }), "/proj/x");
});

Deno.test("resolveWorkspaceDir falls back to $HOME for unset/blank/non-string", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveWorkspaceDir(null), home);
  assertEquals(resolveWorkspaceDir({}), home);
  assertEquals(resolveWorkspaceDir({ workspace: {} }), home);
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "" } }), home);
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "   " } }), home);
  // deno-lint-ignore no-explicit-any
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: 42 as any } }), home);
});

Deno.test("resolveWorkspaceDir expands a leading ~", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "~" } }), home);
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "~/proj/x" } }), `${home}/proj/x`);
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "  ~/proj  " } }), `${home}/proj`);
});

Deno.test("resolveWorkspaceDir leaves a non-leading or ~user tilde untouched", () => {
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "~alice" } }), "~alice");
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "/a/~b" } }), "/a/~b");
});

Deno.test("resolveModuleDir uses the override when set, expanding a leading ~", () => {
  const home = Deno.env.get("HOME");
  // The override wins over the global default, regardless of settings.
  assertEquals(resolveModuleDir("/proj/y", { workspace: { defaultDir: "/proj/x" } }), "/proj/y");
  assertEquals(resolveModuleDir("~/work", { workspace: { defaultDir: "/proj/x" } }), `${home}/work`);
});

Deno.test("resolveModuleDir falls back to the default for a blank/absent override", () => {
  assertEquals(resolveModuleDir(undefined, { workspace: { defaultDir: "/proj/x" } }), "/proj/x");
  assertEquals(resolveModuleDir("", { workspace: { defaultDir: "/proj/x" } }), "/proj/x");
  assertEquals(resolveModuleDir("   ", { workspace: { defaultDir: "/proj/x" } }), "/proj/x");
  // No override and no default → $HOME, same as resolveWorkspaceDir.
  assertEquals(resolveModuleDir(undefined, null), Deno.env.get("HOME"));
});
