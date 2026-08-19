import { assertEquals } from "@std/assert";
import {
  dirtyDirsFrom,
  flatten,
  type Node,
  nodeFromEntry,
  parentDir,
  sortEntries,
  splitName,
  updateAt,
} from "./tree.ts";
import type { Entry } from "../fs.ts";

const e = (name: string, isDir: boolean): Entry => ({
  name,
  path: `/root/${name}`,
  isDir,
  isSymlink: false,
});

Deno.test("sortEntries puts directories first, then case-insensitive alpha", () => {
  const sorted = sortEntries([
    e("banana.txt", false),
    e("Zebra", true),
    e("apple", true),
    e("Ant.txt", false),
  ]);
  assertEquals(sorted.map((x) => x.name), [
    "apple",
    "Zebra",
    "Ant.txt",
    "banana.txt",
  ]);
});

Deno.test("splitName keeps the extension pinned as the tail", () => {
  assertEquals(splitName("layout.ts"), { head: "layout", tail: ".ts" });
  assertEquals(splitName("archive.tar.gz"), {
    head: "archive.tar",
    tail: ".gz",
  });
});

Deno.test("splitName leaves an empty tail when there is no real extension", () => {
  assertEquals(splitName("README"), { head: "README", tail: "" });
  assertEquals(splitName(".gitignore"), { head: ".gitignore", tail: "" });
  assertEquals(splitName("trailingdot."), { head: "trailingdot.", tail: "" });
});

Deno.test("nodeFromEntry starts collapsed with no loaded children", () => {
  const n = nodeFromEntry(e("sub", true));
  assertEquals(n.expanded, false);
  assertEquals(n.children, undefined);
});

Deno.test("flatten yields only visible rows with depth", () => {
  const child: Node = {
    name: "a.txt",
    path: "/root/dir/a.txt",
    isDir: false,
    isSymlink: false,
    expanded: false,
  };
  const dir: Node = {
    name: "dir",
    path: "/root/dir",
    isDir: true,
    isSymlink: false,
    expanded: false,
    children: [child],
  };
  const file: Node = {
    name: "b.txt",
    path: "/root/b.txt",
    isDir: false,
    isSymlink: false,
    expanded: false,
  };

  const collapsed = flatten([dir, file]);
  assertEquals(collapsed.map((r) => r.node.name), ["dir", "b.txt"]);
  assertEquals(collapsed.map((r) => r.depth), [0, 0]);

  const expanded = flatten([{ ...dir, expanded: true }, file]);
  assertEquals(expanded.map((r) => r.node.name), ["dir", "a.txt", "b.txt"]);
  assertEquals(expanded.map((r) => r.depth), [0, 1, 0]);
});

Deno.test("updateAt replaces the node at a path immutably", () => {
  const dir: Node = {
    name: "dir",
    path: "/root/dir",
    isDir: true,
    isSymlink: false,
    expanded: false,
  };
  const roots = [dir];
  const next = updateAt(roots, "/root/dir", (n) => ({ ...n, expanded: true }));
  assertEquals(next[0].expanded, true);
  assertEquals(roots[0].expanded, false); // original untouched
});

Deno.test("updateAt reaches nested children", () => {
  const child: Node = {
    name: "a",
    path: "/root/dir/a",
    isDir: true,
    isSymlink: false,
    expanded: false,
  };
  const dir: Node = {
    name: "dir",
    path: "/root/dir",
    isDir: true,
    isSymlink: false,
    expanded: true,
    children: [child],
  };
  const next = updateAt(
    [dir],
    "/root/dir/a",
    (n) => ({ ...n, expanded: true }),
  );
  assertEquals(next[0].children![0].expanded, true);
});

Deno.test("parentDir strips the last segment, bottoming out at root", () => {
  assertEquals(parentDir("/root/a/b.ts"), "/root/a");
  assertEquals(parentDir("/top"), "/");
});

// Windows paths reach the frontend already normalized to forward slashes (../path.ts),
// so a drive letter is the only thing that distinguishes them here. The drive root is
// the floor, the same way "/" is on POSIX.
Deno.test("parentDir walks a normalized Windows path", () => {
  assertEquals(parentDir("C:/Users/x/proj/a.ts"), "C:/Users/x/proj");
  assertEquals(parentDir("C:/proj"), "C:");
});

// The drive letter is read as an ordinary segment, so "C:" lands in the set — posix
// has no notion of a drive root. Inert: the set is only ever membership-tested against
// real node paths, and no node is ever "C:". The hand-rolled loop did the same.
Deno.test("dirtyDirsFrom collects ancestors of a normalized Windows path", () => {
  const dirs = dirtyDirsFrom(["C:/proj/src/a.ts"]);
  assertEquals([...dirs].sort(), ["C:", "C:/proj", "C:/proj/src"]);
});

Deno.test("dirtyDirsFrom collects every ancestor folder of each change", () => {
  const dirs = dirtyDirsFrom(["/root/a/b/c.ts", "/root/x.ts"]);
  // ancestors of the nested file, plus the root; never the files themselves.
  assertEquals([...dirs].sort(), ["/root", "/root/a", "/root/a/b"]);
});

Deno.test("dirtyDirsFrom dedupes shared ancestors across changes", () => {
  const dirs = dirtyDirsFrom(["/root/a/one.ts", "/root/a/two.ts"]);
  assertEquals([...dirs].sort(), ["/root", "/root/a"]);
});
