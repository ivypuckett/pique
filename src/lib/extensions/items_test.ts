import { assertEquals } from "@std/assert";
import { extensionItems } from "./items.ts";
import type { Extension } from "./bindings.ts";

function ext(over: Partial<Extension> = {}): Extension {
  return { id: "local:linter", name: "linter", origin: "local", ...over };
}

Deno.test("the origin becomes the row badge", () => {
  const items = extensionItems([ext({ origin: "package" })]);
  assertEquals(items[0].badge, "package");
});

// The source string is what a package row is really identified by; a local module has
// none and falls back to its path.
Deno.test("the subtitle prefers the source and falls back to the path", () => {
  assertEquals(
    extensionItems([ext({ source: "npm:@pi/git" })])[0].subtitle,
    "npm:@pi/git",
  );
  assertEquals(
    extensionItems([ext({ path: "/home/x/mod.ts" })])[0].subtitle,
    "/home/x/mod.ts",
  );
});

Deno.test("the key is namespaced by kind", () => {
  assertEquals(extensionItems([ext()])[0].key, "extension/local:linter");
});
