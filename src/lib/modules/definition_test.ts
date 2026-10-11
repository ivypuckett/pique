import { assertEquals } from "@std/assert";
import { parseDefinition } from "./definition.ts";

const ok = (name: string, obj: unknown) =>
  parseDefinition(name, JSON.stringify(obj));

Deno.test("a valid definition parses, taking its kind from the filename", () => {
  const r = ok("notes", { label: "Notes" });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  // The kind is NOT read from the file: it is the extension's own name, so a definition
  // cannot claim to be a different module than the one it sits beside.
  assertEquals(r.def.kind, "notes");
  assertEquals(r.def.label, "Notes");
});

// A definition written for an older build — capabilities, a rationale — still parses;
// the keys it no longer means anything by are dropped rather than refused.
Deno.test("keys a definition no longer uses are ignored", () => {
  const r = ok("notes", {
    label: "Notes",
    rationale: "A scratchpad.",
    capabilities: { storage: true },
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.def, {
      kind: "notes",
      label: "Notes",
      duplicable: undefined,
    });
  }
});

Deno.test("junk is an error, not a throw", () => {
  const r = parseDefinition("notes", "{not json");
  assertEquals(r.ok, false);
});

Deno.test("a missing or empty label is refused", () => {
  assertEquals(ok("notes", {}).ok, false);
  assertEquals(ok("notes", { label: "" }).ok, false);
  assertEquals(ok("notes", { label: 42 }).ok, false);
});

// The name comes from a filename on disk, but this is the only place that turns it into
// a module kind, so it is checked here too rather than trusted.
Deno.test("a name that is not a legal extension name is refused", () => {
  for (const bad of ["../x", "a/b", "Notes", "", "1notes"]) {
    assertEquals(ok(bad, { label: "X" }).ok, false, bad);
  }
});

// An install must never be able to take over a built-in row.
Deno.test("a kind colliding with a built-in is refused at parse time", () => {
  for (
    const builtin of ["terminal", "gitdiff"]
  ) {
    assertEquals(ok(builtin, { label: "Mine" }).ok, false, builtin);
  }
});

Deno.test("duplicable must be a boolean when present", () => {
  assertEquals(ok("notes", { label: "N", duplicable: "yes" }).ok, false);
  const r = ok("notes", { label: "N", duplicable: true });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.def.duplicable, true);
});
