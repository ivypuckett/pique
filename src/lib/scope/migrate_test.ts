import { assertEquals } from "@std/assert";
import { migrateToScopes } from "./migrate.ts";
import { readScopeConfig } from "./config.ts";
import { ROOT, scopeAgentDir, scopeBoardPath, scopesDir } from "./paths.ts";
import { readJson } from "../settings/file.ts";

async function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn(dir);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

// The pre-scope layout: one global agent dir, a boards/ dir keyed by workspace, and
// a settings.json holding both app-level and (now) scoped sections.
async function seedOldLayout(home: string): Promise<void> {
  await Deno.mkdir(`${home}/.pique/agent/extensions`, { recursive: true });
  await Deno.mkdir(`${home}/.pique/boards`, { recursive: true });
  await Deno.writeTextFile(`${home}/.pique/agent/extensions/old_tool.ts`, "// tool");
  await Deno.writeTextFile(`${home}/.pique/agent/settings.json`, `{"packages":[]}`);
  await Deno.writeTextFile(`${home}/.pique/boards/ws-1.db`, "db1");
  await Deno.writeTextFile(`${home}/.pique/boards/ws-1.db-wal`, "wal1");
  await Deno.writeTextFile(`${home}/.pique/boards/ws-3.db`, "db3");
  await Deno.writeTextFile(
    `${home}/.pique/settings.json`,
    JSON.stringify({
      version: 1,
      appearance: { theme: "nord" },
      workspace: { defaultDir: "~/workspace", gitScanDepth: 3 },
      chat: { defaultModel: "m" },
      kanban: { defaultStatuses: [{ name: "Todo" }] },
    }),
  );
}

Deno.test("migration moves the global agent dir to root's scope", async () => {
  await withTempHome(async (home) => {
    await seedOldLayout(home);
    await migrateToScopes();

    assertEquals(await exists(`${scopeAgentDir(ROOT)}/extensions/old_tool.ts`), true);
    assertEquals(await exists(`${scopeAgentDir(ROOT)}/settings.json`), true);
    assertEquals(await exists(`${home}/.pique/agent`), false);
  });
});

Deno.test("migration keeps each board with the workspace it belonged to", async () => {
  await withTempHome(async (home) => {
    await seedOldLayout(home);
    await migrateToScopes();

    assertEquals(await Deno.readTextFile(scopeBoardPath("ws-1")), "db1");
    assertEquals(await Deno.readTextFile(scopeBoardPath("ws-3")), "db3");
    // SQLite siblings travel with the db, or the board opens empty.
    assertEquals(await Deno.readTextFile(`${scopeBoardPath("ws-1")}-wal`), "wal1");
    assertEquals(await exists(`${home}/.pique/boards`), false);
  });
});

Deno.test("migration splits settings into app-level and root-scoped", async () => {
  await withTempHome(async (home) => {
    await seedOldLayout(home);
    await migrateToScopes();

    // The scoped sections became root's config...
    assertEquals(await readScopeConfig(ROOT), {
      chat: { defaultModel: "m" },
      kanban: { defaultStatuses: [{ name: "Todo" }] },
    });
    // ...and left settings.json holding only what is genuinely app-wide.
    assertEquals(await readJson("settings"), {
      version: 1,
      appearance: { theme: "nord" },
      workspace: { defaultDir: "~/workspace", gitScanDepth: 3 },
    });
  });
});

Deno.test("migration is a no-op once the scopes dir exists", async () => {
  await withTempHome(async (home) => {
    await seedOldLayout(home);
    await migrateToScopes();
    // Something changes after the first run — a second run must not clobber it.
    await Deno.writeTextFile(scopeBoardPath("ws-1"), "edited");
    await seedOldLayout(home); // stale pre-scope files reappear

    await migrateToScopes();

    assertEquals(await Deno.readTextFile(scopeBoardPath("ws-1")), "edited");
    assertEquals(await exists(`${home}/.pique/agent`), true); // left alone, not re-moved
  });
});

Deno.test("migration on a fresh install leaves nothing behind but the scopes dir", async () => {
  await withTempHome(async () => {
    await migrateToScopes();
    assertEquals(await exists(scopesDir()), true);
    assertEquals(await readScopeConfig(ROOT), null);
  });
});
