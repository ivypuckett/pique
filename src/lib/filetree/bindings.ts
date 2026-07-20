// Frontend half of the file-tree binding contract. `globalThis.bindings` is injected
// only inside the desktop window; undefined in a plain browser tab. Keep the arg/return
// shapes in sync by hand with the win.bind("listDir") handler in src/desktop.ts.
import type { Entry } from "../fs.ts";

export interface FileTreeBindings {
  listDir(arg: { path?: string }): Promise<Entry[]>;
}

export function fileTreeBindings(): FileTreeBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as FileTreeBindings) : null;
}
