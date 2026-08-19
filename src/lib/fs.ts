// Backend directory reader and editor for the file-tree module. Pure Deno fs — no
// webview. Symlinks are reported (isSymlink) but NOT followed: isDir reflects the link
// itself, so a symlink is never expandable and cannot create a traversal loop.
//
// Paths are built with @std/path so they are native, then normalized to forward
// slashes on the way out — every path here is destined for the file tree in the
// webview (see path.ts).
import { dirname, join } from "@std/path";
import { toWebPath } from "./path.ts";

// A `type` alias (not `interface`) so Entry[] structurally satisfies win.bind's
// object-shaped return type in desktop.ts — matching the codebase's ModelInfo pattern.
export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
};

export async function listDir(path: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const e of Deno.readDir(path)) {
    entries.push({
      name: e.name,
      path: toWebPath(join(path, e.name)),
      isDir: e.isDirectory,
      isSymlink: e.isSymlink,
    });
  }
  return entries;
}

// Parse a name typed into the tree's add/rename prompt into a path relative to the
// directory it lands in. A trailing "/" asks for a directory ("docs/"); a name with
// separators ("a/b/c.ts") nests. Anything that could escape that directory — an
// absolute path or a "." / ".." segment — is refused, so a typed name can only ever
// write below where the tree said it would.
export function parseEntryName(name: string): { rel: string; isDir: boolean } {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("name is empty");
  if (trimmed.startsWith("/")) throw new Error("name must be relative");
  const isDir = trimmed.endsWith("/");
  const rel = isDir ? trimmed.slice(0, -1) : trimmed;
  for (const seg of rel.split("/")) {
    if (seg === "") throw new Error(`invalid name: ${trimmed}`);
    if (seg === "." || seg === "..") {
      throw new Error("name must not contain . or ..");
    }
  }
  return { rel, isDir };
}

// Create an empty file (or a directory, for a trailing-slash name) under `parent`,
// returning its absolute path. Missing intermediate directories are created, but the
// leaf is not: an existing name fails rather than silently reusing or truncating it.
export async function createEntry(
  parent: string,
  name: string,
): Promise<string> {
  const { rel, isDir } = parseEntryName(name);
  const path = join(parent, rel);
  await Deno.mkdir(dirname(path), { recursive: true });
  if (isDir) await Deno.mkdir(path);
  else await Deno.writeTextFile(path, "", { createNew: true });
  return toWebPath(path);
}

// Rename an entry within its own directory, returning its new absolute path. Deno.rename
// silently replaces an existing destination, so an occupied name is refused first — a
// typo'd rename must not eat another file.
export async function renameEntry(path: string, name: string): Promise<string> {
  const { rel } = parseEntryName(name);
  const dest = join(dirname(path), rel);
  const web = toWebPath(dest);
  // Normalized both sides: `path` arrives forward-slashed from the tree while `dest`
  // is native, so comparing them raw would miss a rename to the name it already has
  // and then refuse it as occupied by itself.
  if (web === toWebPath(path)) return web;
  if (await exists(dest)) throw new Error(`already exists: ${rel}`);
  await Deno.rename(path, dest);
  return web;
}

// Delete an entry, recursively for a directory. Permanent — the confirmation the tree
// shows before calling this is the only guard.
export async function removeEntry(path: string): Promise<void> {
  await Deno.remove(path, { recursive: true });
}

// lstat, not stat, so a dangling symlink still counts as occupying the name.
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}
