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

// Return a new tree with the node at `path` replaced by fn(node). Recurses into
// loaded children; nodes off the path are returned unchanged (by reference).
export function updateAt(nodes: Node[], path: string, fn: (n: Node) => Node): Node[] {
  return nodes.map((n) => {
    if (n.path === path) return fn(n);
    if (n.children) return { ...n, children: updateAt(n.children, path, fn) };
    return n;
  });
}
