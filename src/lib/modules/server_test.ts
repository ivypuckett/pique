import { assertEquals, assertThrows } from "@std/assert";
import { uiPathFor } from "./server.ts";

// A module's UI is a sibling of its extension, not a directory: pi auto-discovers
// `extensions/*.ts` by basename, so a directory would not load as an extension at all.
Deno.test("a ui path is a sibling of the extension file it belongs to", () => {
  assertEquals(
    uiPathFor("ws-1", "notes").endsWith(
      "/scopes/ws-1/agent/extensions/notes.ui.html",
    ),
    true,
  );
});

Deno.test("a bad scope or module name is refused, not resolved", () => {
  const cases: [string, string][] = [
    ["../root", "notes"],
    ["ws-1", "../../etc/passwd"],
    ["ws-1", "a/b"],
    ["ws-1", "Notes"], // the extension name regex is lowercase-only
    ["ws-1", ""],
    ["", "notes"],
  ];
  for (const [scope, name] of cases) {
    assertThrows(
      () => uiPathFor(scope, name),
      Error,
      undefined,
      `${scope} ${name}`,
    );
  }
});
