// Backend board service: resolves default statuses from a scope's config and caches
// one open BoardHandle per scope, so the kanban* win.bind handlers (desktop.ts) and
// the agent tools share the same live connection.
//
// Each scope owns one board at ~/.pique/scopes/<id>/board.db. Root's is the shared
// board: a workspace can address it (scope "root"), while root has no way to name a
// workspace's — the visibility rule from scope/paths.ts `chain`. Runs Deno-side only.
import { type BoardHandle, openBoard } from "./board.ts";
import { ROOT, type ScopeId, scopeBoardPath, scopeDir } from "../scope/paths.ts";
import { resolveScopeConfig } from "../scope/config.ts";
import type { Json } from "../settings/file.ts";

// Mirrors DEFAULT_SETTINGS.kanban.defaultStatuses in settings/bindings.ts (separate
// module graph) — keep the two in sync. Used when config has no usable list.
const DEFAULT_STATUSES = [
  { name: "Backlog" },
  { name: "Todo" },
  { name: "In Progress" },
  { name: "Done" },
];

// Names from kanban.defaultStatuses in the scope's resolved config, guarding every
// field (the file is user-editable and may be null/missing/malformed — mirrors
// resolveChatDefaults). A missing or empty result falls back so a board is never
// seeded with 0 columns.
export function resolveKanbanDefaults(config: Json): { name: string }[] {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const k = (config as { [k: string]: Json }).kanban;
    if (k && typeof k === "object" && !Array.isArray(k)) {
      const ds = (k as { [k: string]: Json }).defaultStatuses;
      if (Array.isArray(ds)) {
        const names = ds
          .map((s) =>
            s && typeof s === "object" && !Array.isArray(s)
              ? (s as { [k: string]: Json }).name
              : null
          )
          .filter((n): n is string => typeof n === "string" && n.trim() !== "")
          .map((name) => ({ name }));
        if (names.length > 0) return names;
      }
    }
  }
  return DEFAULT_STATUSES;
}

// Which board a caller in `scope` means. "own" is its own board; "root" is the shared
// one it inherits. A caller already in root means root either way — there is no
// downward reference, so a workspace board is unreachable from root by construction.
export type BoardRef = "own" | "root";

export function resolveBoardScope(scope: ScopeId, ref: BoardRef | undefined): ScopeId {
  return ref === "root" ? ROOT : scope;
}

const handles = new Map<string, BoardHandle>();

// The scope's board, opened (and seeded from its resolved config) on first use, then
// cached. Seeding uses the inherited config, so a workspace board picks up root's
// status list unless the workspace overrides it.
export async function board(scope: ScopeId): Promise<BoardHandle> {
  let h = handles.get(scope);
  if (!h) {
    await Deno.mkdir(scopeDir(scope), { recursive: true });
    h = openBoard(scopeBoardPath(scope), {
      defaultStatuses: resolveKanbanDefaults(await resolveScopeConfig(scope)),
    });
    handles.set(scope, h);
  }
  return h;
}

export function closeAllBoards(): void {
  for (const h of handles.values()) h.close();
  handles.clear();
}
