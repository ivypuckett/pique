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
  createInitialWorkspace,
  focusAdjacent as focusAdjacentFn,
  focusView as focusViewFn,
  isWorkspaceState,
  updateView,
  type WorkspaceState,
} from "./workspace.ts";

const KEY = "pique.layout.v4";

function load(): WorkspaceState {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isWorkspaceState(parsed)) return parsed;
    } catch {
      // corrupt storage — fall back to defaults
    }
  }
  return createInitialWorkspace();
}

export const workspace = writable<WorkspaceState>(load());

// The presented view: keyboard nav and the top bar act on this one.
export const activeView = derived(
  workspace,
  (w) => w.views.find((v) => v.id === w.activeId)!,
);

// Persist on a trailing debounce so a splitter drag (which mutates the store on every
// pointermove) doesn't do synchronous JSON.stringify + setItem on each frame.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
workspace.subscribe((w) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(KEY, JSON.stringify(w)), 150);
});

// View-scoped actions — components pass their own view id, so a view's controls always
// act on that view whether or not it is the active one.
function edit(viewId: string, fn: (v: ViewState) => ViewState): void {
  workspace.update((w) => updateView(w, viewId, fn));
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

// Workspace-level actions — used by the ctrl+h chord and the top bar.
export function addView(): void {
  workspace.update(addViewFn);
}

export function closeView(): void {
  workspace.update(closeViewFn);
}

export function focusAdjacent(dir: -1 | 1): void {
  workspace.update((w) => focusAdjacentFn(w, dir));
}

export function focusView(viewId: string): void {
  workspace.update((w) => focusViewFn(w, viewId));
}

export function activeId(): string {
  return get(workspace).activeId;
}
