import { assertEquals } from "@std/assert";
import {
  createInitialView,
  visibleIds,
  resizeBoundary,
  gridTemplateColumns,
  fixedPx,
  MIN_WIDTH_PCT,
} from "./layout.ts";
import {
  addTab,
  closeTab,
  isViewState,
  resizeRowSplit,
  setActiveTab,
  toggleCollapse,
  toggleRows,
} from "./layout.ts";
import { MIN_ROW_PCT } from "./layout.ts";

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

Deno.test("collapsing left redistributes its width, remembers it", () => {
  const v = toggleCollapse(createInitialView(), "left");
  assertEquals(v.left.collapsed, true);
  assertEquals(v.left.widthPct, 0);
  assertEquals(v.left.savedWidthPct, 20);
  assertEquals(v.center.widthPct, 75); // 60 + 20*(60/80)
  assertEquals(v.right.widthPct, 25); // 20 + 20*(20/80)
  assertEquals(visibleIds(v), ["center", "right"]);
});

Deno.test("expanding restores the original layout", () => {
  const collapsed = toggleCollapse(createInitialView(), "left");
  const v = toggleCollapse(collapsed, "left");
  assertEquals(v.left.collapsed, false);
  assertEquals(v.left.widthPct, 20);
  assertEquals(v.center.widthPct, 60);
  assertEquals(v.right.widthPct, 20);
});

Deno.test("toggleRows adds then removes a second row on a side column", () => {
  const two = toggleRows(createInitialView(), "right");
  assertEquals(two.right.rows.length, 2);
  const one = toggleRows(two, "right");
  assertEquals(one.right.rows.length, 1);
  assertEquals(one.right.rows[0].id, "right-1");
});

Deno.test("resizeRowSplit sets the first-row height and clamps to MIN_ROW_PCT", () => {
  const v = resizeRowSplit(createInitialView(), "left", 70);
  assertEquals(v.left.rowSplitPct, 70);
  assertEquals(resizeRowSplit(createInitialView(), "left", 2).left.rowSplitPct, MIN_ROW_PCT);
  assertEquals(
    resizeRowSplit(createInitialView(), "left", 98).left.rowSplitPct,
    100 - MIN_ROW_PCT,
  );
});

Deno.test("isViewState rejects a column missing rowSplitPct", () => {
  const bad = createInitialView() as unknown as Record<string, Record<string, unknown>>;
  delete bad.left.rowSplitPct;
  assertEquals(isViewState(bad), false);
});

Deno.test("createInitialView sets activeTabId to the first row of each column", () => {
  const v = createInitialView();
  assertEquals(v.left.activeTabId, "left-1");
  assertEquals(v.center.activeTabId, "center-1");
  assertEquals(v.right.activeTabId, "right-1");
});

Deno.test("isViewState rejects a column whose activeTabId names no row", () => {
  const bad = createInitialView();
  bad.center.activeTabId = "center-999";
  assertEquals(isViewState(bad), false);
});

Deno.test("isViewState rejects a column missing activeTabId", () => {
  const bad = createInitialView() as unknown as Record<string, Record<string, unknown>>;
  delete bad.center.activeTabId;
  assertEquals(isViewState(bad), false);
});

Deno.test("addTab appends a tab to center and activates it", () => {
  const v = addTab(createInitialView(), "placeholder");
  assertEquals(v.center.rows.length, 2);
  assertEquals(v.center.rows[1], { id: "center-2", title: "Placeholder", kind: "placeholder" });
  assertEquals(v.center.activeTabId, "center-2");
});

Deno.test("addTab picks the smallest free center-N id", () => {
  let v = addTab(createInitialView(), "terminal"); // center-2
  v = addTab(v, "terminal"); // center-3
  assertEquals(v.center.rows.map((r) => r.id), ["center-1", "center-2", "center-3"]);
});

Deno.test("setActiveTab switches the active center tab", () => {
  const two = addTab(createInitialView(), "placeholder"); // center-2 active
  const v = setActiveTab(two, "center-1");
  assertEquals(v.center.activeTabId, "center-1");
});

Deno.test("setActiveTab is a no-op for an unknown tab id", () => {
  const v = createInitialView();
  assertEquals(setActiveTab(v, "center-999").center.activeTabId, "center-1");
});

Deno.test("closeTab removes a tab", () => {
  const two = addTab(createInitialView(), "placeholder"); // center-1, center-2
  const v = closeTab(two, "center-2");
  assertEquals(v.center.rows.map((r) => r.id), ["center-1"]);
});

Deno.test("closeTab is a no-op when only one tab remains", () => {
  const v = createInitialView();
  assertEquals(closeTab(v, "center-1").center.rows.length, 1);
  assertEquals(closeTab(v, "center-1").center.activeTabId, "center-1");
});

Deno.test("closeTab activates the previous tab when the active one is closed", () => {
  let v = addTab(createInitialView(), "placeholder"); // center-2
  v = addTab(v, "placeholder"); // center-3, active
  v = closeTab(v, "center-3");
  assertEquals(v.center.activeTabId, "center-2"); // previous neighbor
});

Deno.test("closeTab activates the next tab when the first (active) tab is closed", () => {
  let v = addTab(createInitialView(), "placeholder"); // center-2
  v = setActiveTab(v, "center-1"); // center-1 active
  v = closeTab(v, "center-1");
  assertEquals(v.center.rows.map((r) => r.id), ["center-2"]);
  assertEquals(v.center.activeTabId, "center-2"); // no previous, so next
});

Deno.test("closeTab leaves the active tab unchanged when closing a different tab", () => {
  let v = addTab(createInitialView(), "placeholder"); // center-2, active
  v = closeTab(v, "center-1");
  assertEquals(v.center.activeTabId, "center-2");
});

Deno.test("isViewState accepts a real view and rejects malformed shapes", () => {
  assertEquals(isViewState(createInitialView()), true);
  assertEquals(isViewState(null), false);
  assertEquals(isViewState({}), false);
  assertEquals(isViewState({ left: {}, center: {}, right: {} }), false);
  assertEquals(isViewState(JSON.parse(JSON.stringify(createInitialView()))), true);
  // missing a column
  const { right: _right, ...missingRight } = createInitialView();
  assertEquals(isViewState(missingRight), false);
  // a column with an empty rows array (collapsed rail reads rows[0])
  const noRows = createInitialView();
  noRows.left.rows = [];
  assertEquals(isViewState(noRows), false);
});
