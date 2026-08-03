// Backend board service: caches one open BoardHandle per scope, so the kanban*
// win.bind handlers (desktop.ts) and the agent tools share the same live connection.
//
// Each scope owns one board at ~/.pique/scopes/<id>/board.db. Root's is the shared
// board: a workspace can address it (scope "root"), while root has no way to name a
// workspace's — the visibility rule from scope/paths.ts `chain`. Runs Deno-side only.
import { type BoardHandle, openBoard } from "./board.ts";
import {
  ROOT,
  scopeBoardPath,
  scopeDir,
  type ScopeId,
} from "../scope/paths.ts";

// The columns every new board starts with. A board owns its columns from then on —
// they are added, renamed, reordered and deleted on the board itself (Kanban.svelte,
// via the kanban{Add,Rename,Move,Delete}Status binds in desktop.ts), never from config.
const DEFAULT_STATUSES = [
  { name: "Backlog" },
  { name: "Todo" },
  { name: "In Progress" },
  { name: "Done" },
];

// Which board a caller in `scope` means. "own" is its own board; "root" is the shared
// one it inherits. A caller already in root means root either way — there is no
// downward reference, so a workspace board is unreachable from root by construction.
export type BoardRef = "own" | "root";

export function resolveBoardScope(
  scope: ScopeId,
  ref: BoardRef | undefined,
): ScopeId {
  return ref === "root" ? ROOT : scope;
}

const handles = new Map<string, BoardHandle>();

// The scope's board, opened (and seeded with the default columns) on first use, then
// cached.
export async function board(scope: ScopeId): Promise<BoardHandle> {
  let h = handles.get(scope);
  if (!h) {
    await Deno.mkdir(scopeDir(scope), { recursive: true });
    h = openBoard(scopeBoardPath(scope), { defaultStatuses: DEFAULT_STATUSES });
    handles.set(scope, h);
  }
  return h;
}

export function closeAllBoards(): void {
  for (const h of handles.values()) h.close();
  handles.clear();
}
