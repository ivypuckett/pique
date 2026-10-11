import { assertEquals, assertRejects } from "@std/assert";
import {
  readJson,
  resolveAgentDir,
  resolveGitScanDepth,
  resolveModuleDir,
  writeJson,
} from "./file.ts";

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
    await Deno.writeTextFile(
      `${Deno.env.get("HOME")}/.pique/settings.json`,
      "{ not json",
    );
    assertEquals(await readJson("settings"), null);
  });
});

Deno.test("writeJson rejects names with path separators", async () => {
  await withTempHome(async () => {
    await assertRejects(() => writeJson("../evil", {}));
  });
});

Deno.test("resolveModuleDir uses the workspace's directory, expanding a leading ~", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveModuleDir("/proj/y"), "/proj/y");
  assertEquals(resolveModuleDir("~"), home);
  assertEquals(resolveModuleDir("~/work"), `${home}/work`);
  assertEquals(resolveModuleDir("  ~/proj  "), `${home}/proj`);
});

Deno.test("resolveModuleDir leaves a non-leading or ~user tilde untouched", () => {
  assertEquals(resolveModuleDir("~alice"), "~alice");
  assertEquals(resolveModuleDir("/a/~b"), "/a/~b");
});

Deno.test("resolveModuleDir falls back to $HOME for a blank or absent directory", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveModuleDir(undefined), home);
  assertEquals(resolveModuleDir(""), home);
  assertEquals(resolveModuleDir("   "), home);
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
  assertEquals(
    resolveGitScanDepth({
      workspace: { gitScanDepth: "4" as unknown as number },
    }),
    3,
  );
});

Deno.test("resolveAgentDir reads the setting, expanding a leading ~", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveAgentDir({ agent: { dir: "/x/agent" } }), "/x/agent");
  assertEquals(
    resolveAgentDir({ agent: { dir: "~/.pi/agent" } }),
    `${home}/.pi/agent`,
  );
});

Deno.test("resolveAgentDir is undefined for a blank, missing or malformed setting", () => {
  assertEquals(resolveAgentDir(null), undefined);
  assertEquals(resolveAgentDir({}), undefined);
  assertEquals(resolveAgentDir({ agent: { dir: "  " } }), undefined);
  // deno-lint-ignore no-explicit-any
  assertEquals(resolveAgentDir({ agent: { dir: 42 as any } }), undefined);
  assertEquals(resolveAgentDir({ agent: "nope" }), undefined);
});
