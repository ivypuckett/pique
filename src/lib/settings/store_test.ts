import { assert, assertEquals } from "@std/assert";
import { DEFAULT_SETTINGS } from "./bindings.ts";
import { THEMES } from "./store.ts";

Deno.test("THEMES has no duplicates", () => {
  assertEquals(new Set(THEMES).size, THEMES.length);
});

Deno.test("THEMES includes the default theme", () => {
  assert(THEMES.includes(DEFAULT_SETTINGS.appearance.theme));
});

Deno.test("THEMES leads with catppuccin-frappe", () => {
  assertEquals(THEMES[0], "catppuccin-frappe");
});
