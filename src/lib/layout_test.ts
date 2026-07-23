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
  addDiffTab,
  addEditorTab,
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
  const v = resizeBoundary(createInitialView(), "center-left", 40);
  assertEquals(v.center.widthPct, 40);
  assertEquals(v.left.widthPct, 40); // 80 combined - 40
  assertEquals(v.right.widthPct, 20);
});

Deno.test("resizeBoundary clamps to MIN_WIDTH_PCT", () => {
  const v = resizeBoundary(createInitialView(), "center-left", 2);
  assertEquals(v.center.widthPct, MIN_WIDTH_PCT);
  assertEquals(v.left.widthPct, 80 - MIN_WIDTH_PCT);
});

Deno.test("gridTemplateColumns lists fr tracks and splitters when all visible", () => {
  // Visual order: chat (center) | explorer (left) | popups (right).
  assertEquals(gridTemplateColumns(createInitialView()), "60fr 6px 20fr 6px 20fr");
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

Deno.test("toggleRows removes then re-adds the second row on the left column", () => {
  const one = toggleRows(createInitialView(), "left");
  assertEquals(one.left.rows.length, 1);
  assertEquals(one.left.rows[0].id, "left-1");
  const two = toggleRows(one, "left");
  assertEquals(two.left.rows.length, 2);
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

Deno.test("addTab appends a tab to the right column and activates it", () => {
  const v = addTab(createInitialView(), "placeholder");
  assertEquals(v.right.rows.length, 2);
  assertEquals(v.right.rows[1], { id: "right-2", title: "Placeholder", kind: "placeholder" });
  assertEquals(v.right.activeTabId, "right-2");
});

Deno.test("addTab picks the smallest free right-N id", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2
  v = addTab(v, "terminal"); // right-3
  assertEquals(v.right.rows.map((r) => r.id), ["right-1", "right-2", "right-3"]);
});

Deno.test("setActiveTab switches the active right tab", () => {
  const two = addTab(createInitialView(), "placeholder"); // right-2 active
  const v = setActiveTab(two, "right-1");
  assertEquals(v.right.activeTabId, "right-1");
});

Deno.test("setActiveTab is a no-op for an unknown tab id", () => {
  const v = createInitialView();
  assertEquals(setActiveTab(v, "right-999").right.activeTabId, "right-1");
});

Deno.test("closeTab removes a tab", () => {
  const two = addTab(createInitialView(), "placeholder"); // right-1, right-2
  const v = closeTab(two, "right-2");
  assertEquals(v.right.rows.map((r) => r.id), ["right-1"]);
});

Deno.test("closeTab closes the last tab, emptying the column", () => {
  const v = createInitialView();
  const closed = closeTab(v, "right-1");
  assertEquals(closed.right.rows.length, 0);
  assertEquals(closed.right.activeTabId, "");
});

Deno.test("closeTab activates the previous tab when the active one is closed", () => {
  let v = addTab(createInitialView(), "placeholder"); // right-2
  v = addTab(v, "placeholder"); // right-3, active
  v = closeTab(v, "right-3");
  assertEquals(v.right.activeTabId, "right-2"); // previous neighbor
});

Deno.test("closeTab activates the next tab when the first (active) tab is closed", () => {
  let v = addTab(createInitialView(), "placeholder"); // right-2
  v = setActiveTab(v, "right-1"); // right-1 active
  v = closeTab(v, "right-1");
  assertEquals(v.right.rows.map((r) => r.id), ["right-2"]);
  assertEquals(v.right.activeTabId, "right-2"); // no previous, so next
});

Deno.test("closeTab leaves the active tab unchanged when closing a different tab", () => {
  let v = addTab(createInitialView(), "placeholder"); // right-2, active
  v = closeTab(v, "right-1");
  assertEquals(v.right.activeTabId, "right-2");
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
  // the right (tab) column is valid with zero tabs — closing every tab empties it
  const noTabs = createInitialView();
  noTabs.right.rows = [];
  noTabs.right.activeTabId = "";
  assertEquals(isViewState(noTabs), true);
});

Deno.test("addEditorTab adds an active right-column terminal tab titled with the basename", () => {
  const v = createInitialView();
  const before = v.right.rows.length;
  const next = addEditorTab(v, "/home/ivy/workspace/pique/src/lib/layout.ts");
  assertEquals(next.right.rows.length, before + 1);
  const tab = next.right.rows[next.right.rows.length - 1];
  assertEquals(tab.kind, "terminal");
  assertEquals(tab.title, "layout.ts");
  assertEquals(next.right.activeTabId, tab.id);
  assertEquals(tab.props, { argv: ["$EDITOR", "/home/ivy/workspace/pique/src/lib/layout.ts"], autoCloseOnExit: true, autoFocus: true });
});

Deno.test("addEditorTab falls back to the full path when there is no basename", () => {
  const tab = addEditorTab(createInitialView(), "/").right.rows.at(-1)!;
  assertEquals(tab.title, "/");
});

Deno.test("addDiffTab adds an active right-column gitdiff tab scoped to the file path", () => {
  const v = createInitialView();
  const before = v.right.rows.length;
  const next = addDiffTab(v, "/home/ivy/workspace/pique/src/lib/layout.ts");
  assertEquals(next.right.rows.length, before + 1);
  const tab = next.right.rows[next.right.rows.length - 1];
  assertEquals(tab.kind, "gitdiff");
  assertEquals(tab.title, "layout.ts");
  assertEquals(next.right.activeTabId, tab.id);
  assertEquals(tab.props, { path: "/home/ivy/workspace/pique/src/lib/layout.ts" });
});
