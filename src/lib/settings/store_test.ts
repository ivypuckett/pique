import { assert, assertEquals } from "@std/assert";
import { DEFAULT_SETTINGS } from "./bindings.ts";
import { mergeSettings, THEMES } from "./store.ts";

Deno.test("mergeSettings keeps a partial persisted section over defaults", () => {
  const merged = mergeSettings({ workspace: { gitScanDepth: 7 } });
  assertEquals(merged.workspace.gitScanDepth, 7);
  // Untouched sections still fall back to defaults.
  assertEquals(merged.appearance.theme, DEFAULT_SETTINGS.appearance.theme);
});

Deno.test("mergeSettings fills a section's defaults when it is absent", () => {
  const merged = mergeSettings({ appearance: { theme: "nord" } });
  assertEquals(merged.workspace.gitScanDepth, DEFAULT_SETTINGS.workspace.gitScanDepth);
});

Deno.test("THEMES has no duplicates", () => {
  assertEquals(new Set(THEMES).size, THEMES.length);
});

Deno.test("THEMES includes the default theme", () => {
  assert(THEMES.includes(DEFAULT_SETTINGS.appearance.theme));
});

Deno.test("THEMES leads with catppuccin-frappe", () => {
  assertEquals(THEMES[0], "catppuccin-frappe");
});
