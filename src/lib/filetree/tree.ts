import type { Entry } from "../fs.ts";

export interface Node {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  expanded: boolean;
  children?: Node[]; // undefined = not yet loaded
}

export interface Row {
  node: Node;
  depth: number;
}

export function nodeFromEntry(e: Entry): Node {
  return { name: e.name, path: e.path, isDir: e.isDir, isSymlink: e.isSymlink, expanded: false };
}

// Directories first, then files; each group case-insensitive alphabetical.
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// Split a filename into a shrinkable head and a pinned extension (e.g. ".ts") so the
// UI can middle-truncate long names as "head….ext" instead of cutting the extension.
// Names with no extension, and dotfiles with no other dot (".gitignore"), get an empty
// tail and truncate normally from the end.
export function splitName(name: string): { head: string; tail: string } {
  const i = name.lastIndexOf(".");
  if (i > 0 && i < name.length - 1) return { head: name.slice(0, i), tail: name.slice(i) };
  return { head: name, tail: "" };
}

// Depth-first list of currently visible rows: a directory's children appear only
// when it is expanded and its children are loaded.
export function flatten(nodes: Node[], depth = 0): Row[] {
  const rows: Row[] = [];
  for (const n of nodes) {
    rows.push({ node: n, depth });
    if (n.isDir && n.expanded && n.children) {
      rows.push(...flatten(n.children, depth + 1));
    }
  }
  return rows;
}

// Set of every ancestor directory that contains a changed path. For "/a/b/c.ts" this
// adds "/a" and "/a/b" (not the file itself), so any folder node on the way down to a
// change can be highlighted, even folders not yet lazily loaded.
export function dirtyDirsFrom(paths: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    let dir = i <= 0 ? "" : p.slice(0, i);
    while (dir !== "") {
      dirs.add(dir);
      const j = dir.lastIndexOf("/");
      dir = j <= 0 ? "" : dir.slice(0, j);
    }
  }
  return dirs;
}

// Directory containing `path` — where a sibling of that entry would be created.
export function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

// Return a new tree with the node at `path` replaced by fn(node). Recurses into
// loaded children; nodes off the path are returned unchanged (by reference).
export function updateAt(nodes: Node[], path: string, fn: (n: Node) => Node): Node[] {
  return nodes.map((n) => {
    if (n.path === path) return fn(n);
    if (n.children) return { ...n, children: updateAt(n.children, path, fn) };
    return n;
  });
}
