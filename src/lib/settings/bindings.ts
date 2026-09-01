// Frontend half of the config binding contract. The backend half is the config*
// win.bind handlers in src/desktop.ts, which delegate to settings/file.ts —
// keep arg/return shapes in sync by hand (separate module graphs).
import type { Entry } from "../fs.ts";

// App-level user prefs — the ones that are NOT per-scope. Chat defaults used to live
// here; they are now per-scope and inherited, so they sit in
// ~/.pique/scopes/<id>/config.json instead (see ../scope/bindings.ts). The default
// working directory moved too: it is the root workspace's cwd, in the layout tree.
// The layout tree persists separately under the "layout" config (see ../store.ts).
export interface Settings {
  version: number;
  // zoom: the UI scale factor, applied as the root font size (main.ts) — every
  // rem-sized thing in the app follows it. One of ZOOM_LEVELS (settings/store.ts).
  // uiFont/monoFont: CSS font-family values, overriding tailwind's --font-sans and
  // --font-mono at the root (main.ts). Empty means the built-in stack, so they are not
  // optional fields with a compiled-in default — "" IS the default, and the settings
  // field being blank and the setting being absent have to mean the same thing.
  appearance: { theme: string; zoom: number; uiFont: string; monoFont: string };
  // gitScanDepth: how many directory levels to descend looking for git repos when the
  // workspace root is not itself a repo, to highlight changed folders. Absent → the
  // resolveGitScanDepth default (see settings/file.ts).
  // confirmDelete: whether the file tree's `dd` asks before deleting. Read on the
  // frontend only — the backend deletes whatever it is told to.
  workspace: { gitScanDepth?: number; confirmDelete?: boolean };
  // enabled: per-provider model ids the pickers offer, keyed by provider id. A provider
  // with no entry has its whole catalog enabled (see settings/models.ts).
  models: { enabled: Record<string, string[]> };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: { theme: "catppuccin-frappe", zoom: 1, uiFont: "", monoFont: "" },
  // gitScanDepth default mirrors resolveGitScanDepth's fallback in settings/file.ts
  // (separate module graph) — keep the two in sync.
  workspace: { gitScanDepth: 3, confirmDelete: true },
  models: { enabled: {} },
};

interface ConfigBindings {
  configRead(arg: { name: string }): Promise<unknown | null>;
  configWrite(arg: { name: string; data: unknown }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — callers
// then run in-memory with no persistence, same as the chat bindings.
function config(): ConfigBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ConfigBindings) : null;
}

export async function readConfig(name: string): Promise<unknown | null> {
  return (await config()?.configRead({ name })) ?? null;
}

export async function writeConfig(name: string, data: unknown): Promise<void> {
  await config()?.configWrite({ name, data });
}

interface WindowBindings {
  windowSetSize(arg: { width: number; height: number }): Promise<unknown>;
}

// Grows the window to fill the display, which is how the app "starts maximized":
// deno desktop has no maximize API, so the size has to come from here, where
// screen.availWidth/availHeight gives the work area with the menu bar, dock, and
// panels already subtracted. No-op in web-dev (no bindings), where the browser owns
// the window anyway.
export async function fillDisplay(): Promise<void> {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  await (b as WindowBindings | undefined)?.windowSetSize({
    width: screen.availWidth,
    height: screen.availHeight,
  });
}

interface OpenBindings {
  openExternal(arg: { url: string }): Promise<unknown>;
}

// Hand a URL to the desktop's browser, returning whether the desktop backend took it.
// Synchronous by design, despite the async work it kicks off: the caller is a link's
// click handler deciding whether to preventDefault, and a preventDefault after an await
// comes too late to stop the navigation. False means web-dev, where there is no backend
// and the anchor's own target="_blank" is the right behavior anyway.
export function openExternal(url: string): boolean {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  if (!b) return false;
  void (b as OpenBindings).openExternal({ url });
  return true;
}

interface ListBindings {
  listDir(arg: { path?: string }): Promise<Entry[]>;
}

// What `path` contains, for the working-directory picker (../PathInput.svelte). Shares
// the file tree's listDir bind, which expands a leading "~" backend-side, so the picker
// can list exactly the string the box shows.
//
// Null means the path is not a readable directory — it doesn't exist, or it's a file.
// That is how the picker both greys out a bad path and refuses to commit it, so the two
// failure modes must stay distinct from an empty directory. Web-dev, where there is no
// backend at all, returns empty rather than null: no completions, but nothing rejected.
export async function listEntries(path: string): Promise<Entry[] | null> {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  if (!b) return [];
  try {
    return await (b as ListBindings).listDir({ path });
  } catch {
    return null;
  }
}
