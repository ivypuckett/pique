import { createInitialWorkspace, type WorkspaceState } from "./workspace.ts";

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
export function addWorkspace(s: SessionState): SessionState {
  const n = nextWorkspaceNumber(s.workspaces);
  const w = createInitialWorkspace(`ws-${n}`, `Workspace ${n}`);
  return { workspaces: [...s.workspaces, w], activeId: w.id };
}
