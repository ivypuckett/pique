import {
  createInitialWorkspace,
  isWorkspaceState,
  type WorkspaceState,
} from "./workspace.ts";
import { ROOT } from "./scope/paths.ts";

// A session is the root workspace plus an ordered set of numbered workspaces,
// navigated vertically (ctrl+j j/k). Exactly one is "active" (the shown workspace).
// Workspaces are not tiled on screen: only the active one renders, mirroring how a
// workspace presents one of its views.
//
// Root is a workspace like any other on screen, but it is also every other
// workspace's parent: tools, prefs and its Kanban board are visible from a numbered
// workspace, never the reverse (see scope/paths.ts `chain`). It cannot be closed, so
// `workspaces` may be empty — closing the last numbered workspace falls back to root
// rather than resurrecting a blank one.
export interface SessionState {
  root: WorkspaceState; // id ROOT; always present
  workspaces: WorkspaceState[]; // may be empty, ordered below root in the rail
  activeId: string; // ROOT, or the id of one of `workspaces`
}

// Smallest free "ws-N", mirroring workspace.ts's nextViewId so ids stay deterministic
// and test-friendly. Returns the number so the caller can title the workspace with it.
function nextWorkspaceNumber(workspaces: WorkspaceState[]): number {
  const used = new Set(workspaces.map((w) => w.id));
  let n = 1;
  while (used.has(`ws-${n}`)) n++;
  return n;
}

export function createInitialSession(): SessionState {
  return {
    root: createInitialWorkspace(ROOT, "Root"),
    workspaces: [],
    activeId: ROOT,
  };
}

// Root first, then the numbered workspaces — rail order, and the order ctrl+j j/k
// walks. The single place that ordering is defined.
export function allWorkspaces(s: SessionState): WorkspaceState[] {
  return [s.root, ...s.workspaces];
}

export function workspaceById(
  s: SessionState,
  id: string,
): WorkspaceState | undefined {
  return allWorkspaces(s).find((w) => w.id === id);
}

// Append a fresh workspace and make it active. The title is fixed at creation from the
// id's number and never renumbers — it is a name, not a position. Closing ws-2 of three
// and adding one yields a rail reading 1, 3, 2. This is intended (see design spec).
// An optional cwd seeds the new workspace's working-directory override (ctrl+j o).
export function addWorkspace(s: SessionState, cwd?: string): SessionState {
  const n = nextWorkspaceNumber(s.workspaces);
  const w = createInitialWorkspace(`ws-${n}`, `Workspace ${n}`);
  const seeded = cwd && cwd.trim() !== "" ? { ...w, cwd } : w;
  return { ...s, workspaces: [...s.workspaces, seeded], activeId: w.id };
}

// Remove the active workspace. Root is the parent scope and has no neighbor to fall
// back to, so closing it is a no-op. Otherwise activate the previous numbered
// neighbor if one exists, else the next, else root.
export function closeWorkspace(s: SessionState): SessionState {
  if (s.activeId === ROOT) return s;
  const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
  if (idx === -1) return s;
  const workspaces = s.workspaces.filter((w) => w.id !== s.activeId);
  const activeId = (workspaces[idx - 1] ?? workspaces[idx])?.id ?? ROOT;
  return { ...s, workspaces, activeId };
}

// Move the active id to the neighbor in `dir` (-1 = up, +1 = down) through the rail
// order, root included. Clamped at the ends (no wrap), matching view navigation.
export function focusAdjacent(s: SessionState, dir: -1 | 1): SessionState {
  const all = allWorkspaces(s);
  const idx = all.findIndex((w) => w.id === s.activeId);
  if (idx === -1) return s;
  const next = Math.min(all.length - 1, Math.max(0, idx + dir));
  return { ...s, activeId: all[next].id };
}

export function focusWorkspace(s: SessionState, id: string): SessionState {
  if (!workspaceById(s, id)) return s;
  return { ...s, activeId: id };
}

// Replace one workspace by id via a workspace-level reducer, leaving the others alone.
// Addresses root by its id, so every view-level action works there unchanged.
export function updateWorkspace(
  s: SessionState,
  id: string,
  fn: (w: WorkspaceState) => WorkspaceState,
): SessionState {
  if (id === ROOT) return { ...s, root: fn(s.root) };
  return {
    ...s,
    workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w)),
  };
}

// Structural guard for persisted state, mirroring isWorkspaceState one level up.
export function isSessionState(s: unknown): s is SessionState {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  if (!isWorkspaceState(obj.root)) return false;
  if (!Array.isArray(obj.workspaces)) return false;
  if (!obj.workspaces.every(isWorkspaceState)) return false;
  if (typeof obj.activeId !== "string") return false;
  const ids = [
    obj.root.id,
    ...(obj.workspaces as WorkspaceState[]).map((w) => w.id),
  ];
  return ids.includes(obj.activeId);
}

// Persisted layouts written before root existed are `{ workspaces, activeId }`. Adopt
// them by adding a fresh root above the workspaces they already have, rather than
// discarding the tree. `defaultDir` is the old global setting, which root's cwd now
// supersedes (see settings/file.ts resolveModuleDir).
export function migrateSession(
  raw: unknown,
  defaultDir?: string,
): SessionState | null {
  if (isSessionState(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (
    !Array.isArray(obj.workspaces) || !obj.workspaces.every(isWorkspaceState)
  ) return null;
  const workspaces = obj.workspaces as WorkspaceState[];
  const root = createInitialWorkspace(ROOT, "Root");
  const seeded = defaultDir && defaultDir.trim() !== ""
    ? { ...root, cwd: defaultDir }
    : root;
  const activeId = typeof obj.activeId === "string" &&
      workspaces.some((w) => w.id === obj.activeId)
    ? obj.activeId
    : (workspaces[0]?.id ?? ROOT);
  return { root: seeded, workspaces, activeId };
}
