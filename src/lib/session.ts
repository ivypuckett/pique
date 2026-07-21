import { createInitialWorkspace, isWorkspaceState, type WorkspaceState } from "./workspace.ts";

// A session is an ordered set of workspaces, navigated vertically (ctrl+j j/k). Exactly
// one is "active" (the shown workspace). Workspaces are not tiled on screen: only the
// active one renders, mirroring how a workspace presents one of its views.
export interface SessionState {
  workspaces: WorkspaceState[]; // >= 1, ordered top-to-bottom in the rail
  activeId: string; // names one of the workspaces
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
  const w = createInitialWorkspace();
  return { workspaces: [w], activeId: w.id };
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

// Remove the active workspace, keeping at least one. Activates the previous neighbor if
// one exists, otherwise the next (matching closeView's neighbor rule). Closing the last
// workspace resets it to a fresh empty workspace rather than refusing.
export function closeWorkspace(s: SessionState): SessionState {
  if (s.workspaces.length <= 1) {
    const w = createInitialWorkspace();
    return { workspaces: [w], activeId: w.id };
  }
  const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
  if (idx === -1) return s;
  const workspaces = s.workspaces.filter((w) => w.id !== s.activeId);
  const activeId = (workspaces[idx - 1] ?? workspaces[idx]).id;
  return { ...s, workspaces, activeId };
}

// Move the active id to the neighbor in `dir` (-1 = up, +1 = down). Clamped at the ends
// (no wrap), matching view navigation.
export function focusAdjacent(s: SessionState, dir: -1 | 1): SessionState {
  const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
  if (idx === -1) return s;
  const next = Math.min(s.workspaces.length - 1, Math.max(0, idx + dir));
  return { ...s, activeId: s.workspaces[next].id };
}

export function focusWorkspace(s: SessionState, id: string): SessionState {
  if (!s.workspaces.some((w) => w.id === id)) return s;
  return { ...s, activeId: id };
}

// Replace one workspace by id via a workspace-level reducer, leaving the others alone.
export function updateWorkspace(
  s: SessionState,
  id: string,
  fn: (w: WorkspaceState) => WorkspaceState,
): SessionState {
  return { ...s, workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w)) };
}

// Structural guard for persisted state, mirroring isWorkspaceState one level up.
export function isSessionState(s: unknown): s is SessionState {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  if (!Array.isArray(obj.workspaces) || obj.workspaces.length === 0) return false;
  if (!obj.workspaces.every(isWorkspaceState)) return false;
  return typeof obj.activeId === "string" &&
    (obj.workspaces as WorkspaceState[]).some((w) => w.id === obj.activeId);
}
