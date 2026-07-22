import { assert, assertEquals } from "@std/assert";
import { DEFAULT_SETTINGS } from "./bindings.ts";
import { mergeSettings, THEMES } from "./store.ts";

Deno.test("mergeSettings keeps a partial persisted kanban over defaults", () => {
  const merged = mergeSettings({ kanban: { defaultStatuses: [{ name: "A" }, { name: "B" }] } });
  assertEquals(merged.kanban.defaultStatuses, [{ name: "A" }, { name: "B" }]);
  // Untouched sections still fall back to defaults.
  assertEquals(merged.appearance.theme, DEFAULT_SETTINGS.appearance.theme);
});

Deno.test("mergeSettings fills kanban defaults when the section is absent", () => {
  const merged = mergeSettings({ appearance: { theme: "nord" } });
  assertEquals(merged.kanban.defaultStatuses, DEFAULT_SETTINGS.kanban.defaultStatuses);
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
