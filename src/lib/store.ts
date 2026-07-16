import { derived, get, writable } from "svelte/store";
import {
  addTab as addTabFn,
  type Boundary,
  closeTab as closeTabFn,
  createInitialView,
  resizeBoundary as resize,
  resizeRowSplit as resizeRowFn,
  setActiveTab as setActiveTabFn,
  type SideId,
  toggleCollapse as collapseFn,
  toggleRows as rowsFn,
  type ViewState,
} from "./layout.ts";
import {
  addView as addViewFn,
  closeView as closeViewFn,
  focusAdjacent as focusAdjacentFn,
  focusView as focusViewFn,
  updateView,
  type WorkspaceState,
} from "./workspace.ts";
import {
  addWorkspace as addWorkspaceFn,
  closeWorkspace as closeWorkspaceFn,
  createInitialSession,
  focusAdjacent as focusAdjacentWorkspaceFn,
  focusWorkspace as focusWorkspaceFn,
  isSessionState,
  type SessionState,
  updateWorkspace,
} from "./session.ts";

// v5: the top-level shape gained a session wrapping N workspaces. Stored v4 layouts fail
// isSessionState and fall back to defaults — no migration (see design spec).
const KEY = "pique.layout.v5";

function load(): SessionState {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isSessionState(parsed)) return parsed;
    } catch {
      // corrupt storage — fall back to defaults
    }
  }
  return createInitialSession();
}

export const session = writable<SessionState>(load());

// The shown workspace: the rail's selection, and what view-level actions target.
export const activeWorkspace = derived(
  session,
  (s) => s.workspaces.find((w) => w.id === s.activeId)!,
);

// The presented view of the shown workspace: keyboard nav and the top bar act on this.
export const activeView = derived(
  activeWorkspace,
  (w) => w.views.find((v) => v.id === w.activeId)!,
);

// Persist on a trailing debounce so a splitter drag (which mutates the store on every
// pointermove) doesn't do synchronous JSON.stringify + setItem on each frame.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
session.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(KEY, JSON.stringify(s)), 150);
});

// Workspace-scoped edit: applies a workspace-level reducer to the shown workspace.
function editWorkspace(fn: (w: WorkspaceState) => WorkspaceState): void {
  session.update((s) => updateWorkspace(s, s.activeId, fn));
}

// View-scoped actions — components pass their own view id, so a view's controls always
// act on that view whether or not it is the active one. Views are addressed within the
// shown workspace.
function edit(viewId: string, fn: (v: ViewState) => ViewState): void {
  editWorkspace((w) => updateView(w, viewId, fn));
}

export function resizeBoundary(viewId: string, b: Boundary, newFirstPct: number): void {
  edit(viewId, (v) => resize(v, b, newFirstPct));
}

export function toggleCollapse(viewId: string, id: SideId): void {
  edit(viewId, (v) => collapseFn(v, id));
}

export function toggleRows(viewId: string, id: SideId): void {
  edit(viewId, (v) => rowsFn(v, id));
}

export function resizeRow(viewId: string, id: SideId, newFirstPct: number): void {
  edit(viewId, (v) => resizeRowFn(v, id, newFirstPct));
}

export function addTab(viewId: string, kind: string): void {
  edit(viewId, (v) => addTabFn(v, kind));
}

export function setActiveTab(viewId: string, tabId: string): void {
  edit(viewId, (v) => setActiveTabFn(v, tabId));
}

export function closeTab(viewId: string, tabId: string): void {
  edit(viewId, (v) => closeTabFn(v, tabId));
}

export function resetView(viewId: string): void {
  edit(viewId, (v) => createInitialView(v.id));
}

// View-level actions — used by the ctrl+h chord and the top bar. They target the shown
// workspace's views.
export function addView(): void {
  editWorkspace(addViewFn);
}

export function closeView(): void {
  editWorkspace(closeViewFn);
}

export function focusAdjacent(dir: -1 | 1): void {
  editWorkspace((w) => focusAdjacentFn(w, dir));
}

export function focusView(viewId: string): void {
  editWorkspace((w) => focusViewFn(w, viewId));
}

// Returns the active VIEW id of the shown workspace — App.svelte and TopBar.svelte pass
// it to view-scoped actions, so its meaning is unchanged from before the session existed.
export function activeId(): string {
  return get(activeWorkspace).activeId;
}

// Session-level actions — used by the ctrl+j chord and the workspace rail.
export function addWorkspace(): void {
  session.update(addWorkspaceFn);
}

export function closeWorkspace(): void {
  session.update(closeWorkspaceFn);
}

// Named to disambiguate from the view-level focusAdjacent above; the asymmetry keeps
// every existing view call site untouched.
export function focusAdjacentWorkspace(dir: -1 | 1): void {
  session.update((s) => focusAdjacentWorkspaceFn(s, dir));
}

export function focusWorkspace(id: string): void {
  session.update((s) => focusWorkspaceFn(s, id));
}
