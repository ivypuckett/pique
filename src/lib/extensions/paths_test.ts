import { assertEquals, assertThrows } from "@std/assert";
import {
  assertExtensionName,
  liveDir,
  livePath,
  packageSlug,
  packageSource,
  pendingDir,
  pendingPackagePath,
  pendingPath,
} from "./paths.ts";
import { ROOT } from "../scope/paths.ts";

function withHome(home: string, fn: () => void): void {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
}

Deno.test("live and pending are separate dirs inside the scope's agent dir", () => {
  withHome("/home/x", () => {
    const base = "/home/x/.pique/scopes/ws-1/agent";
    assertEquals(liveDir("ws-1"), `${base}/extensions`);
    assertEquals(pendingDir("ws-1"), `${base}/pending`);
    assertEquals(livePath("ws-1", "my_ext"), `${base}/extensions/my_ext.ts`);
    assertEquals(pendingPath("ws-1", "my_ext"), `${base}/pending/my_ext.ts`);
  });
});

Deno.test("each scope gets its own pair of dirs", () => {
  withHome("/home/x", () => {
    assertEquals(liveDir(ROOT), "/home/x/.pique/scopes/root/agent/extensions");
    assertEquals(liveDir("ws-2"), "/home/x/.pique/scopes/ws-2/agent/extensions");
  });
});

Deno.test("local extension names cannot escape their directory", () => {
  for (const bad of ["../evil", "a/b", "/abs", "", ".", "Upper", "9lead", "has-dash", "sp ace"]) {
    assertThrows(() => assertExtensionName(bad), Error, "invalid extension name");
  }
});

Deno.test("local extension names accept lowercase identifiers", () => {
  for (const ok of ["a", "lookup_weather", "ext9", "a_b_c"]) assertExtensionName(ok);
});

Deno.test("a bad scope id is refused before it reaches the filesystem", () => {
  withHome("/home/x", () => {
    assertThrows(() => liveDir("../evil"), Error, "invalid scope id");
    assertThrows(() => pendingPath("a/b", "ok_name"), Error, "invalid scope id");
  });
});

// The pending dir holds both origins, so a package's filename must be reversible —
// that is what keeps it a set of files rather than a ledger with a separate source list.
Deno.test("package slugs round-trip every source form pi accepts", () => {
  for (
    const source of [
      "npm:pi-crew",
      "npm:@scope/pkg",
      "git:github.com/user/repo",
      "https://github.com/user/repo.git",
      "git@github.com:user/repo.git",
      "/abs/path/to/pkg",
      "../relative/pkg",
      "npm:pkg@^1.2.3",
    ]
  ) {
    assertEquals(packageSource(packageSlug(source)), source);
  }
});

Deno.test("a package slug can never contain a separator", () => {
  for (const source of ["npm:@scope/pkg", "/abs/path", "../../escape", "a/b/c"]) {
    assertEquals(packageSlug(source).includes("/"), false);
  }
});

Deno.test("a traversal-shaped source stays one file inside the pending dir", () => {
  withHome("/home/x", () => {
    const base = "/home/x/.pique/scopes/ws-1/agent/pending";
    // "/" is percent-encoded, so the result is a single filename, not a path.
    assertEquals(pendingPackagePath("ws-1", "../../evil"), `${base}/..%2F..%2Fevil.json`);
    assertEquals(pendingPackagePath("ws-1", "npm:@scope/pkg"), `${base}/npm%3A%40scope%2Fpkg.json`);
  });
});
