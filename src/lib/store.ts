import { writable } from "svelte/store";
import {
  type Boundary,
  createInitialView,
  resizeBoundary as resize,
  type SideId,
  toggleCollapse as collapseFn,
  toggleRows as rowsFn,
  type ViewState,
} from "./layout.ts";

const KEY = "pique.layout.v1";

function load(): ViewState {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as ViewState;
    } catch {
      // corrupt storage — fall back to defaults
    }
  }
  return createInitialView();
}

export const view = writable<ViewState>(load());

view.subscribe((v) => localStorage.setItem(KEY, JSON.stringify(v)));

export function resizeBoundary(b: Boundary, newFirstPct: number): void {
  view.update((v) => resize(v, b, newFirstPct));
}

export function toggleCollapse(id: SideId): void {
  view.update((v) => collapseFn(v, id));
}

export function toggleRows(id: SideId): void {
  view.update((v) => rowsFn(v, id));
}
