import { assertEquals } from "@std/assert";
import {
  createInitialView,
  visibleIds,
  resizeBoundary,
  gridTemplateColumns,
  fixedPx,
  MIN_WIDTH_PCT,
} from "./layout.ts";

Deno.test("createInitialView starts at 20/60/20, none collapsed", () => {
  const v = createInitialView();
  assertEquals(v.left.widthPct, 20);
  assertEquals(v.center.widthPct, 60);
  assertEquals(v.right.widthPct, 20);
  assertEquals([v.left.collapsed, v.center.collapsed, v.right.collapsed], [false, false, false]);
});

Deno.test("visible widths sum to 100", () => {
  const v = createInitialView();
  const sum = visibleIds(v).reduce((s, id) => s + v[id].widthPct, 0);
  assertEquals(sum, 100);
});

Deno.test("center has one row, left has two", () => {
  const v = createInitialView();
  assertEquals(v.center.rows.length, 1);
  assertEquals(v.left.rows.length, 2);
});

Deno.test("resizeBoundary moves width between two columns, keeps their sum", () => {
  const v = resizeBoundary(createInitialView(), "left-center", 30);
  assertEquals(v.left.widthPct, 30);
  assertEquals(v.center.widthPct, 50); // 80 combined - 30
  assertEquals(v.right.widthPct, 20);
});

Deno.test("resizeBoundary clamps to MIN_WIDTH_PCT", () => {
  const v = resizeBoundary(createInitialView(), "left-center", 2);
  assertEquals(v.left.widthPct, MIN_WIDTH_PCT);
  assertEquals(v.center.widthPct, 80 - MIN_WIDTH_PCT);
});

Deno.test("gridTemplateColumns lists fr tracks and splitters when all visible", () => {
  assertEquals(gridTemplateColumns(createInitialView()), "20fr 6px 60fr 6px 20fr");
});

Deno.test("fixedPx counts two splitters when all visible", () => {
  assertEquals(fixedPx(createInitialView()), 12);
});
