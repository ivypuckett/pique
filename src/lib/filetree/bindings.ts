// Frontend half of the file-tree binding contract. `globalThis.bindings` is injected
// only inside the desktop window; undefined in a plain browser tab. Keep the arg/return
// shapes in sync by hand with the win.bind("listDir") handler in src/desktop.ts.
import type { Entry } from "../fs.ts";
import type { ChangedPath } from "../gitdiff/git.ts";

export interface FileTreeBindings {
  listDir(arg: { path?: string }): Promise<Entry[]>;
  // Absolute paths changed in the git repo(s) under `path`; used to highlight the tree.
  // Optional so a desktop build without the handler degrades to no highlighting.
  gitChanges?(arg: { path?: string }): Promise<{ changes: ChangedPath[] }>;
  // Edits behind the tree's a / r / dd keys. They reject on a bad name, a taken name,
  // or a permission error, and the tree shows the thrown message in its error strip.
  // `parent` undefined means the module's own working directory (as with listDir).
  createEntry(arg: { parent?: string; name: string }): Promise<{ path: string }>;
  renameEntry(arg: { path: string; name: string }): Promise<{ path: string }>;
  removeEntry(arg: { path: string }): Promise<unknown>;
}

export function fileTreeBindings(): FileTreeBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as FileTreeBindings) : null;
}
