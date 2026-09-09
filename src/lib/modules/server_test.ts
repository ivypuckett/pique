import { assertEquals, assertThrows } from "@std/assert";
import { modulePolicy, uiPathFor } from "./server.ts";

// The header is the network control, and the only one there is: a sandboxed frame with
// no CSP reached a recording server through img.src, no-cors fetch, sendBeacon,
// <script src>, <link href> and WebSocket alike (spec: "Outbound requests"). If this
// string weakens, a module silently gets the network back and no test but this one
// would notice.
Deno.test("the CSP grants inline script and style, and nothing else", () => {
  const p = modulePolicy();
  assertEquals(p.includes("default-src 'none'"), true);
  assertEquals(p.includes("script-src 'unsafe-inline'"), true);
  assertEquals(p.includes("style-src 'unsafe-inline'"), true);
  // 'self' matches nothing from an opaque origin — measured, not assumed. Including it
  // would only mislead a reader into thinking a module may ship separate files.
  assertEquals(p.includes("'self'"), false);
  // default-src covers connect/img/font/frame; naming them would suggest the omission
  // of one is meaningful.
  assertEquals(p.includes("connect-src"), false);
});

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
