import { assertEquals } from "@std/assert";
import { allows, type Manifest } from "./capabilities.ts";

const m = (caps: Manifest["capabilities"]): Manifest => ({
  kind: "notes",
  label: "Notes",
  capabilities: caps,
});

Deno.test("a granted method is allowed", () => {
  assertEquals(allows(m({ storage: true }), "storageGet", {}), true);
});

Deno.test("an ungranted method is refused", () => {
  assertEquals(allows(m({ storage: true }), "fsRead", { path: "/x" }), false);
});

// The method list is a closed set. A method nobody granted — including one added to
// the broker later and forgotten here — must be refused by default, which is why this
// asserts against a manifest holding every capability there is.
Deno.test("an unknown method is refused even with every capability granted", () => {
  const all = m({
    storage: true,
    fs: { read: ["/"], write: ["/"] },
  });
  assertEquals(allows(all, "termStart", {}), false);
  assertEquals(allows(all, "chatPrompt", {}), false);
  assertEquals(allows(all, "settingsWrite", {}), false);
  // Removed from the set when it turned out nothing implemented it.
  assertEquals(allows(all, "agentPrompt", {}), false);
  assertEquals(allows(all, "", {}), false);
});

Deno.test("fs.read is bounded by its declared roots", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  assertEquals(allows(notes, "fsRead", { path: "/home/u/notes/a.md" }), true);
  assertEquals(allows(notes, "fsRead", { path: "/home/u/notes" }), true);
  assertEquals(allows(notes, "fsRead", { path: "/home/u/secrets" }), false);
});

// The traversal case, spelled out because it is the one an attacker reaches for first.
Deno.test("a traversal out of a declared root is refused", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  for (
    const p of [
      "/home/u/notes/../secrets",
      "/home/u/notes/../../etc/passwd",
      "/home/u/notes/./../x",
      "/home/u/notes/sub/../../secrets",
    ]
  ) {
    assertEquals(allows(notes, "fsRead", { path: p }), false, p);
  }
});

// A prefix is not a parent: /home/u/notes-private is not inside /home/u/notes. A
// startsWith check passes this test's opposite, which is why it is here.
Deno.test("a sibling sharing a name prefix is not inside the root", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  assertEquals(
    allows(notes, "fsRead", { path: "/home/u/notes-private/x" }),
    false,
  );
  assertEquals(allows(notes, "fsRead", { path: "/home/u/notesecret" }), false);
});

Deno.test("read does not imply write", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  assertEquals(allows(notes, "fsWrite", { path: "/home/u/notes/a.md" }), false);
});

Deno.test("write does not imply read", () => {
  const notes = m({ fs: { write: ["/home/u/notes"] } });
  assertEquals(allows(notes, "fsRead", { path: "/home/u/notes/a.md" }), false);
  assertEquals(allows(notes, "fsWrite", { path: "/home/u/notes/a.md" }), true);
});

// A relative path cannot be checked against an absolute root without guessing what it
// is relative TO. Refuse rather than resolve against the process's cwd, which is the
// checkout the user happened to launch from.
Deno.test("a relative or empty path is refused rather than resolved", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  for (const p of ["notes/a.md", "", "./a.md", "~/notes/a.md"]) {
    assertEquals(
      allows(notes, "fsRead", { path: p }),
      false,
      JSON.stringify(p),
    );
  }
});

// The payload comes from a frame, so it is not to be trusted to have the shape the
// method implies.
Deno.test("an fs call with no usable path is refused", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  assertEquals(allows(notes, "fsRead", {}), false);
  assertEquals(allows(notes, "fsRead", { path: 42 }), false);
  assertEquals(allows(notes, "fsRead", null), false);
});

Deno.test("an empty manifest permits nothing", () => {
  assertEquals(allows(m({}), "storageGet", {}), false);
  assertEquals(allows(m({}), "fsRead", { path: "/home/u/notes/a.md" }), false);
  assertEquals(allows(m({}), "storageGet", {}), false);
});

// An fs capability naming no roots grants no paths — an empty list is a grant of
// nothing, never a wildcard.
Deno.test("an fs grant with an empty root list permits nothing", () => {
  assertEquals(
    allows(m({ fs: { read: [] } }), "fsRead", { path: "/x" }),
    false,
  );
});
