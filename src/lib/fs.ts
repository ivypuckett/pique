// Backend directory reader for the file-tree module. Pure Deno fs — no webview.
// Symlinks are reported (isSymlink) but NOT followed: isDir reflects the link itself,
// so a symlink is never expandable and cannot create a traversal loop.

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
}

export async function listDir(path: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const e of Deno.readDir(path)) {
    entries.push({
      name: e.name,
      path: `${path.replace(/\/$/, "")}/${e.name}`,
      isDir: e.isDirectory,
      isSymlink: e.isSymlink,
    });
  }
  return entries;
}
