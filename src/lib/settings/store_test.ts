import { assert, assertEquals } from "@std/assert";
import { DEFAULT_SETTINGS } from "./bindings.ts";
import { mergeSettings, stepZoom, THEMES, ZOOM_LEVELS } from "./store.ts";

Deno.test("mergeSettings keeps a partial persisted section over defaults", () => {
  const merged = mergeSettings({ workspace: { gitScanDepth: 7 } });
  assertEquals(merged.workspace.gitScanDepth, 7);
  // Untouched sections still fall back to defaults.
  assertEquals(merged.appearance.theme, DEFAULT_SETTINGS.appearance.theme);
});

Deno.test("mergeSettings fills a section's defaults when it is absent", () => {
  const merged = mergeSettings({ appearance: { theme: "nord" } });
  assertEquals(
    merged.workspace.gitScanDepth,
    DEFAULT_SETTINGS.workspace.gitScanDepth,
  );
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

Deno.test("ZOOM_LEVELS is ascending and includes the default", () => {
  assertEquals([...ZOOM_LEVELS].sort((a, b) => a - b), [...ZOOM_LEVELS]);
  assert(ZOOM_LEVELS.includes(DEFAULT_SETTINGS.appearance.zoom));
});

Deno.test("stepZoom moves one rung at a time", () => {
  assertEquals(stepZoom(1, 1), 1.1);
  assertEquals(stepZoom(1, -1), 0.9);
  assertEquals(stepZoom(stepZoom(1, 1), -1), 1);
});

Deno.test("stepZoom clamps at both ends", () => {
  const [min] = ZOOM_LEVELS;
  const max = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  assertEquals(stepZoom(min, -1), min);
  assertEquals(stepZoom(max, 1), max);
});

Deno.test("stepZoom snaps an off-ladder value to the nearest rung first", () => {
  // 1.2 sits between 1.1 and 1.25, nearer 1.25 — so up is 1.5, down is 1.1.
  assertEquals(stepZoom(1.2, 1), 1.5);
  assertEquals(stepZoom(1.2, -1), 1.1);
  // Out of range entirely: snap to the end rung, then step from there.
  assertEquals(stepZoom(9, -1), 1.75);
  assertEquals(stepZoom(0, 1), 0.67);
});
