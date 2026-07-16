import { writable } from "svelte/store";
import {
  addTab as addTabFn,
  type Boundary,
  closeTab as closeTabFn,
  createInitialView,
  isViewState,
  resizeBoundary as resize,
  resizeRowSplit as resizeRowFn,
  setActiveTab as setActiveTabFn,
  type SideId,
  toggleCollapse as collapseFn,
  toggleRows as rowsFn,
  type ViewState,
} from "./layout.ts";

const KEY = "pique.layout.v3";

function load(): ViewState {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isViewState(parsed)) return parsed;
    } catch {
      // corrupt storage — fall back to defaults
    }
  }
  return createInitialView();
}

export const view = writable<ViewState>(load());

// Persist on a trailing debounce so a splitter drag (which mutates the store on every
// pointermove) doesn't do synchronous JSON.stringify + setItem on each frame.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
view.subscribe((v) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(KEY, JSON.stringify(v)), 150);
});

export function resizeBoundary(b: Boundary, newFirstPct: number): void {
  view.update((v) => resize(v, b, newFirstPct));
}

export function toggleCollapse(id: SideId): void {
  view.update((v) => collapseFn(v, id));
}

export function toggleRows(id: SideId): void {
  view.update((v) => rowsFn(v, id));
}

export function resizeRow(id: SideId, newFirstPct: number): void {
  view.update((v) => resizeRowFn(v, id, newFirstPct));
}

export function addTab(kind: string): void {
  view.update((v) => addTabFn(v, kind));
}

export function setActiveTab(tabId: string): void {
  view.update((v) => setActiveTabFn(v, tabId));
}

export function closeTab(tabId: string): void {
  view.update((v) => closeTabFn(v, tabId));
}

export function resetLayout(): void {
  view.set(createInitialView());
}
