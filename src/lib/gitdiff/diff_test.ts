import { assertEquals } from "@std/assert";
import { langFromName, splitDiff } from "./diff.ts";

const MODIFY = `diff --git a/src/foo.ts b/src/foo.ts
index 111..222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
`;

const ADD = `diff --git a/new.py b/new.py
new file mode 100644
index 000..333
--- /dev/null
+++ b/new.py
@@ -0,0 +1 @@
+print("hi")
`;

const DELETE = `diff --git a/gone.rs b/gone.rs
deleted file mode 100644
index 444..000
--- a/gone.rs
+++ /dev/null
@@ -1 +0,0 @@
-fn main() {}
`;

const RENAME = `diff --git a/old.md b/docs/new.md
similarity index 100%
rename from old.md
rename to docs/new.md
`;

Deno.test("splitDiff separates each file", () => {
  const files = splitDiff(MODIFY + ADD + DELETE);
  assertEquals(files.length, 3);
  assertEquals(files.map((f) => f.newName), ["src/foo.ts", "new.py", "/dev/null"]);
});

Deno.test("splitDiff keeps the full per-file diff as the hunk", () => {
  const [f] = splitDiff(MODIFY);
  assertEquals(f.hunk, MODIFY.trimEnd());
  assertEquals(f.oldName, "src/foo.ts");
  assertEquals(f.newName, "src/foo.ts");
  assertEquals(f.lang, "typescript");
});

Deno.test("splitDiff handles added file (old is /dev/null)", () => {
  const [f] = splitDiff(ADD);
  assertEquals(f.oldName, "/dev/null");
  assertEquals(f.newName, "new.py");
  assertEquals(f.lang, "python");
});

Deno.test("splitDiff handles deleted file, lang from the old name", () => {
  const [f] = splitDiff(DELETE);
  assertEquals(f.newName, "/dev/null");
  assertEquals(f.oldName, "gone.rs");
  assertEquals(f.lang, "rust");
});

Deno.test("splitDiff falls back to the header for a pure rename", () => {
  const [f] = splitDiff(RENAME);
  assertEquals(f.oldName, "old.md");
  assertEquals(f.newName, "docs/new.md");
});

Deno.test("splitDiff returns empty for no changes", () => {
  assertEquals(splitDiff(""), []);
  assertEquals(splitDiff("\n"), []);
});

Deno.test("langFromName maps known extensions and blanks unknown", () => {
  assertEquals(langFromName("a/b.tsx"), "typescript");
  assertEquals(langFromName("x.json"), "json");
  assertEquals(langFromName("Makefile"), "");
  assertEquals(langFromName("/dev/null"), "");
});
