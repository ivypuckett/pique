import { assertEquals } from "@std/assert";
import { extensionItems } from "./items.ts";
import type { Extension } from "./bindings.ts";

function ext(over: Partial<Extension> = {}): Extension {
  return {
    id: "linter",
    name: "linter",
    origin: "local",
    state: "pending",
    scope: "ws-2",
    ...over,
  };
}

// An extension from an ancestor scope is enabled and revoked in root, never here, so it
// is inherited whatever its own state says. Reading `state` instead would offer a
// workspace an Enable button for a row it cannot act on.
Deno.test("an extension from another scope is inherited whatever its own state", () => {
  const items = extensionItems(
    [ext({ scope: "root", state: "enabled" })],
    "ws-2",
  );
  assertEquals(items[0].state, "inherited");
});

Deno.test("in its own scope, pending awaits review and enabled is active", () => {
  const items = extensionItems([
    ext({ id: "a", name: "a", state: "pending" }),
    ext({ id: "b", name: "b", state: "enabled" }),
  ], "ws-2");
  assertEquals(items.map((i) => i.state), ["pending", "active"]);
});

Deno.test("the origin becomes the row badge", () => {
  const items = extensionItems([ext({ origin: "package" })], "ws-2");
  assertEquals(items[0].badge, "package");
});

// The source string is what a package row is really identified by; a local module has
// none and falls back to its path.
Deno.test("the subtitle prefers the source and falls back to the path", () => {
  assertEquals(
    extensionItems([ext({ source: "npm:@pi/git" })], "ws-2")[0].subtitle,
    "npm:@pi/git",
  );
  assertEquals(
    extensionItems([ext({ path: "/home/x/mod.ts" })], "ws-2")[0].subtitle,
    "/home/x/mod.ts",
  );
});

// The key carries the item's OWN scope, not the viewed one, so root's copy and a
// workspace's copy of the same name never collide in the expanded-row state.
Deno.test("the key is namespaced by kind and by the item's own scope", () => {
  const items = extensionItems([ext({ scope: "root", id: "linter" })], "ws-2");
  assertEquals(items[0].key, "extension/root/linter");
});
