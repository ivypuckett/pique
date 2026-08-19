// One-shot move of the pre-scope layout on disk into ~/.pique/scopes/root.
//
//   ~/.pique/agent/          → ~/.pique/scopes/root/agent/      (tools + packages)
//   ~/.pique/boards/ws-N.db  → ~/.pique/scopes/ws-N/board.db    (per-workspace boards)
//   settings.json {chat,kanban} → ~/.pique/scopes/root/config.json
//
// Guarded by the existence of ~/.pique/scopes, so it runs at most once and is a no-op
// on a fresh install. Renames rather than copies — the old paths are the only copy of
// the user's boards. Called once at desktop startup. Runs Deno-side only.
import { readJson, writeJson } from "../settings/file.ts";
import { ROOT, scopeBoardPath, scopeDir, scopesDir } from "./paths.ts";
import { writeScopeConfig } from "./config.ts";
import { home } from "../home.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

// SQLite leaves -shm/-wal siblings next to the db; move them with it or the board
// opens as an empty database.
async function moveBoard(from: string, to: string): Promise<void> {
  await Deno.mkdir(to.slice(0, to.lastIndexOf("/")), { recursive: true });
  for (const suffix of ["", "-shm", "-wal"]) {
    if (await exists(from + suffix)) {
      await Deno.rename(from + suffix, to + suffix);
    }
  }
}

export async function migrateToScopes(): Promise<void> {
  if (await exists(scopesDir())) return;

  const pique = `${home()}/.pique`;
  await Deno.mkdir(scopeDir(ROOT), { recursive: true });

  // Tools, packages and pi settings become root's — every workspace inherits them,
  // which is what they effectively were when there was only one global agent dir.
  if (await exists(`${pique}/agent`)) {
    await Deno.rename(`${pique}/agent`, `${scopeDir(ROOT)}/agent`);
  }

  // Each board keeps the workspace it belonged to; a board whose workspace is gone
  // from layout.json still moves, so reviving that id finds its cards again.
  const boards = `${pique}/boards`;
  if (await exists(boards)) {
    for await (const entry of Deno.readDir(boards)) {
      if (!entry.isFile || !entry.name.endsWith(".db")) continue;
      const id = entry.name.slice(0, -3);
      await moveBoard(`${boards}/${entry.name}`, scopeBoardPath(id));
    }
    await Deno.remove(boards, { recursive: true }).catch(() => {});
  }

  // The scoped sections of the old global settings file become root's config; the
  // rest (appearance, workspace) stays app-level in settings.json.
  const settings = await readJson("settings");
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const s = settings as Record<string, unknown>;
    const scoped: Record<string, unknown> = {};
    if (s.chat) scoped.chat = s.chat;
    if (s.kanban) scoped.kanban = s.kanban;
    if (Object.keys(scoped).length > 0) await writeScopeConfig(ROOT, scoped);
    delete s.chat;
    delete s.kanban;
    await writeJson("settings", s);
  }
}
