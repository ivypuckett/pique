import { assertEquals } from "@std/assert";
import { flatten, type Node, nodeFromEntry, sortEntries, updateAt } from "./tree.ts";
import type { Entry } from "../fs.ts";

const e = (name: string, isDir: boolean): Entry => ({
  name,
  path: `/root/${name}`,
  isDir,
  isSymlink: false,
});

Deno.test("sortEntries puts directories first, then case-insensitive alpha", () => {
  const sorted = sortEntries([e("banana.txt", false), e("Zebra", true), e("apple", true), e("Ant.txt", false)]);
  assertEquals(sorted.map((x) => x.name), ["apple", "Zebra", "Ant.txt", "banana.txt"]);
});

Deno.test("nodeFromEntry starts collapsed with no loaded children", () => {
  const n = nodeFromEntry(e("sub", true));
  assertEquals(n.expanded, false);
  assertEquals(n.children, undefined);
});

Deno.test("flatten yields only visible rows with depth", () => {
  const child: Node = { name: "a.txt", path: "/root/dir/a.txt", isDir: false, isSymlink: false, expanded: false };
  const dir: Node = { name: "dir", path: "/root/dir", isDir: true, isSymlink: false, expanded: false, children: [child] };
  const file: Node = { name: "b.txt", path: "/root/b.txt", isDir: false, isSymlink: false, expanded: false };

  const collapsed = flatten([dir, file]);
  assertEquals(collapsed.map((r) => r.node.name), ["dir", "b.txt"]);
  assertEquals(collapsed.map((r) => r.depth), [0, 0]);

  const expanded = flatten([{ ...dir, expanded: true }, file]);
  assertEquals(expanded.map((r) => r.node.name), ["dir", "a.txt", "b.txt"]);
  assertEquals(expanded.map((r) => r.depth), [0, 1, 0]);
});

Deno.test("updateAt replaces the node at a path immutably", () => {
  const dir: Node = { name: "dir", path: "/root/dir", isDir: true, isSymlink: false, expanded: false };
  const roots = [dir];
  const next = updateAt(roots, "/root/dir", (n) => ({ ...n, expanded: true }));
  assertEquals(next[0].expanded, true);
  assertEquals(roots[0].expanded, false); // original untouched
});

Deno.test("updateAt reaches nested children", () => {
  const child: Node = { name: "a", path: "/root/dir/a", isDir: true, isSymlink: false, expanded: false };
  const dir: Node = { name: "dir", path: "/root/dir", isDir: true, isSymlink: false, expanded: true, children: [child] };
  const next = updateAt([dir], "/root/dir/a", (n) => ({ ...n, expanded: true }));
  assertEquals(next[0].children![0].expanded, true);
});
