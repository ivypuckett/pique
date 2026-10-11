import { assertEquals, assertThrows } from "@std/assert";
import { uiPathFor } from "./server.ts";

// A module's UI is a sibling of its extension, not a directory: pi auto-discovers
// `extensions/*.ts` by basename, so a directory would not load as an extension at all.
Deno.test("a ui path is a sibling of the extension file it belongs to", () => {
  assertEquals(
    uiPathFor("notes").endsWith("/.pique/agent/extensions/notes.ui.html"),
    true,
  );
});

Deno.test("a bad module name is refused, not resolved", () => {
  for (
    const name of [
      "../../etc/passwd",
      "a/b",
      "Notes", // the extension name regex is lowercase-only
      "",
    ]
  ) {
    assertThrows(() => uiPathFor(name), Error, undefined, name);
  }
});
