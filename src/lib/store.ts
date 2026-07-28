import { derived, get, writable } from "svelte/store";
import {
  addTab as addTabFn,
  type Boundary,
  closeTab as closeTabFn,
  createInitialView,
  addDiffTab as addDiffTabFn,
  addEditorTab as addEditorTabFn,
  resizeBoundary as resize,
  setActiveTab as setActiveTabFn,
  setExplorerHidden as setExplorerHiddenFn,
  type SideId,
  toggleCollapse as collapseFn,
  type ViewState,
} from "./layout.ts";
import {
  addView as addViewFn,
  closeView as closeViewFn,
  focusAdjacent as focusAdjacentFn,
  focusView as focusViewFn,
  setWorkspaceDir as setWorkspaceDirFn,
  updateView,
  type WorkspaceState,
} from "./workspace.ts";
import {
  addWorkspace as addWorkspaceFn,
  allWorkspaces,
  closeWorkspace as closeWorkspaceFn,
  createInitialSession,
  focusAdjacent as focusAdjacentWorkspaceFn,
  focusWorkspace as focusWorkspaceFn,
  isSessionState,
  migrateSession,
  type SessionState,
  updateWorkspace,
  workspaceById,
} from "./session.ts";
import { readConfig, writeConfig } from "./settings/bindings.ts";

// The layout tree persists to ~/.pique/layout.json (moved off localStorage — old
// clients just lose their stored layout, no migration; the app isn't distributed).
export const session = writable<SessionState>(createInitialSession());

// Whether the workspace rail is hidden (ctrl+b). A transient UI preference, not part of
// the persisted session — it resets to visible on reload.
export const workspaceRailHidden = writable(false);

// Async hydrate from disk: the store renders defaults first, then this swaps in the
// persisted tree once the config read resolves. Call once at startup (main.ts).
let hydrated = false;

export async function hydrateSession(): Promise<void> {
  const raw = await readConfig("layout");
  // Layouts written before the root workspace existed are adopted under a fresh
  // root, seeded with the old global default dir that root's cwd now supersedes.
  const settings = await readConfig("settings");
  const defaultDir = (settings as { workspace?: { defaultDir?: unknown } } | null)
    ?.workspace?.defaultDir;
  const adopted = !isSessionState(raw);
  const migrated = migrateSession(raw, typeof defaultDir === "string" ? defaultDir : undefined);
  if (migrated) session.set(migrated);
  hydrated = true;
  // set() above ran while `hydrated` was still false, so the persist subscription
  // skipped it — right for a tree read back unchanged, wrong for one we just
  // transformed. Write an adopted tree NOW: the settings.workspace.defaultDir that
  // seeded root's cwd is dropped the first time settings are persisted, so leaving
  // the old shape on disk until the user's next action risks losing it.
  if (migrated && adopted) await writeConfig("layout", migrated);
}

// Every workspace in rail order, root first — what the rail and Session.svelte render.
export const workspaces = derived(session, allWorkspaces);

// The shown workspace: the rail's selection, and what view-level actions target.
// Falls back to root, which is the one workspace guaranteed to exist.
export const activeWorkspace = derived(
  session,
  (s) => workspaceById(s, s.activeId) ?? s.root,
);

// The presented view of the shown workspace: keyboard nav and the top bar act on this.
export const activeView = derived(
  activeWorkspace,
  (w) => w.views.find((v) => v.id === w.activeId)!,
);

// Persist on a trailing debounce so a splitter drag (which mutates the store on every
// pointermove) doesn't write to disk on each frame. Suppressed until hydration so the
// initial default set() can't clobber the persisted file before it's read.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
session.subscribe((s) => {
  if (!hydrated) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeConfig("layout", s), 150);
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

export function setExplorerHidden(viewId: string, hidden: boolean): void {
  edit(viewId, (v) => setExplorerHiddenFn(v, hidden));
}

export function addTab(viewId: string, kind: string): void {
  edit(viewId, (v) => addTabFn(v, kind));
}

// Open `path` in $EDITOR as a self-closing center tab (called by the file-tree module).
export function openEditor(viewId: string, path: string): void {
  edit(viewId, (v) => addEditorTabFn(v, path));
}

// Open the git diff of `path` as a center tab (called by the file-tree module, gd chord).
export function openDiff(viewId: string, path: string): void {
  edit(viewId, (v) => addDiffTabFn(v, path));
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

// Set the shown workspace's working-directory override (top bar). New modules in
// this workspace spawn there; running ones are untouched.
export function setWorkspaceDir(dir: string): void {
  editWorkspace((w) => setWorkspaceDirFn(w, dir));
}

// Returns the active VIEW id of the shown workspace — App.svelte and TopBar.svelte pass
// it to view-scoped actions, so its meaning is unchanged from before the session existed.
export function activeId(): string {
  return get(activeWorkspace).activeId;
}

// Session-level actions — used by the ctrl+j chord and the workspace rail. An optional
// cwd seeds the new workspace's working-directory override (ctrl+j o, from the picker).
export function addWorkspace(cwd?: string): void {
  session.update((s) => addWorkspaceFn(s, cwd));
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
