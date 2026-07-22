// Backend board service: resolves default statuses from settings and caches one
// open BoardHandle per workspace, so the kanban* win.bind handlers (desktop.ts)
// and the agent tools share the same live connection. Runs Deno-side only.
import { type BoardHandle, openBoard } from "./board.ts";
import { boardPath, ensureBoardsDir } from "./paths.ts";
import type { Json } from "../settings/file.ts";

// Mirrors DEFAULT_SETTINGS.kanban.defaultStatuses in settings/bindings.ts (separate
// module graph) — keep the two in sync. Used when settings has no usable list.
const DEFAULT_STATUSES = [
  { name: "Backlog" },
  { name: "Todo" },
  { name: "In Progress" },
  { name: "Done" },
];

// Names from settings.kanban.defaultStatuses, guarding every field (the file is
// user-editable and may be null/missing/malformed — mirrors resolveChatDefaults).
// A missing or empty result falls back so a board is never seeded with 0 columns.
export function resolveKanbanDefaults(settings: Json): { name: string }[] {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const k = (settings as { [k: string]: Json }).kanban;
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

const handles = new Map<string, BoardHandle>();

// The workspace's board, opened (and seeded from settings) on first use, then cached.
export async function board(workspaceId: string, settings: Json): Promise<BoardHandle> {
  let h = handles.get(workspaceId);
  if (!h) {
    await ensureBoardsDir();
    h = openBoard(boardPath(workspaceId), { defaultStatuses: resolveKanbanDefaults(settings) });
    handles.set(workspaceId, h);
  }
  return h;
}

export function closeAllBoards(): void {
  for (const h of handles.values()) h.close();
  handles.clear();
}
