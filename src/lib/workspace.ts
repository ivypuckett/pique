import { createInitialView, isViewState, type ViewState } from "./layout.ts";

// A workspace is an ordered set of views tiled horizontally with equal width. Exactly
// one view is "active" (the presented view); keyboard navigation moves the active id
// between neighbors, and view-level actions target it.
export interface WorkspaceState {
  id: string; // stable across the workspace's lifetime; keys the session list
  title: string; // "Workspace N", assigned at creation; never renumbered
  views: ViewState[]; // >= 1, tiled left-to-right
  activeId: string; // names one of the views
}

export function createInitialWorkspace(id = "ws-1", title = "Workspace 1"): WorkspaceState {
  const view = createInitialView("view-1");
  return { id, title, views: [view], activeId: view.id };
}

// Smallest free "view-N" id, mirroring layout.ts's nextCenterId so ids stay
// deterministic and test-friendly.
function nextViewId(views: ViewState[]): string {
  const used = new Set(views.map((v) => v.id));
  let n = 1;
  while (used.has(`view-${n}`)) n++;
  return `view-${n}`;
}

// Append a fresh view and make it active.
export function addView(w: WorkspaceState): WorkspaceState {
  const view = createInitialView(nextViewId(w.views));
  return { ...w, views: [...w.views, view], activeId: view.id };
}

// Remove the active view, keeping at least one. Activates the previous neighbor if one
// exists, otherwise the next (matching closeTab's neighbor rule).
export function closeView(w: WorkspaceState): WorkspaceState {
  if (w.views.length <= 1) return w;
  const idx = w.views.findIndex((v) => v.id === w.activeId);
  if (idx === -1) return w;
  const views = w.views.filter((v) => v.id !== w.activeId);
  const activeId = (views[idx - 1] ?? views[idx]).id;
  return { ...w, views, activeId };
}

// Move the active id to the neighbor in `dir` (-1 = left, +1 = right). Clamped at the
// ends (no wrap).
export function focusAdjacent(w: WorkspaceState, dir: -1 | 1): WorkspaceState {
  const idx = w.views.findIndex((v) => v.id === w.activeId);
  if (idx === -1) return w;
  const next = Math.min(w.views.length - 1, Math.max(0, idx + dir));
  return { ...w, activeId: w.views[next].id };
}

export function focusView(w: WorkspaceState, id: string): WorkspaceState {
  if (!w.views.some((v) => v.id === id)) return w;
  return { ...w, activeId: id };
}

// Replace one view by id via a view-level reducer, leaving the others untouched.
export function updateView(
  w: WorkspaceState,
  id: string,
  fn: (v: ViewState) => ViewState,
): WorkspaceState {
  return { ...w, views: w.views.map((v) => (v.id === id ? fn(v) : v)) };
}

// Structural guard for persisted state, mirroring isViewState's role for a single view.
export function isWorkspaceState(w: unknown): w is WorkspaceState {
  if (typeof w !== "object" || w === null) return false;
  const obj = w as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.title !== "string") return false;
  if (!Array.isArray(obj.views) || obj.views.length === 0) return false;
  if (!obj.views.every(isViewState)) return false;
  return typeof obj.activeId === "string" &&
    (obj.views as ViewState[]).some((v) => v.id === obj.activeId);
}
