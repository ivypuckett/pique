import { assertEquals } from "@std/assert";
import {
  createInitialView,
  fixedPx,
  gridTemplateColumns,
  MIN_WIDTH_PCT,
  resizeBoundary,
  visibleIds,
} from "./layout.ts";
import {
  addDiffTab,
  addEditorTab,
  addTab,
  closeTab,
  isViewState,
  setActiveTab,
  setExplorerHidden,
  toggleCollapse,
} from "./layout.ts";

Deno.test("createInitialView starts at chat 60 / pane 40, explorer half the pane, none collapsed", () => {
  const v = createInitialView();
  assertEquals(v.center.widthPct, 60);
  assertEquals(v.right.widthPct, 40);
  assertEquals(v.explorer, { widthPct: 50, hidden: false });
  assertEquals([v.center.collapsed, v.right.collapsed], [false, false]);
});

Deno.test("visible widths sum to 100", () => {
  const v = createInitialView();
  const sum = visibleIds(v).reduce((s, id) => s + v[id].widthPct, 0);
  assertEquals(sum, 100);
});

Deno.test("center and right each have one row", () => {
  const v = createInitialView();
  assertEquals(v.center.rows.length, 1);
  assertEquals(v.right.rows.length, 1);
});

Deno.test("resizeBoundary moves width between chat and the pane, keeps their sum", () => {
  const v = resizeBoundary(createInitialView(), "center-right", 40);
  assertEquals(v.center.widthPct, 40);
  assertEquals(v.right.widthPct, 60); // 100 combined - 40
});

Deno.test("resizeBoundary clamps to MIN_WIDTH_PCT", () => {
  const v = resizeBoundary(createInitialView(), "center-right", 2);
  assertEquals(v.center.widthPct, MIN_WIDTH_PCT);
  assertEquals(v.right.widthPct, 100 - MIN_WIDTH_PCT);
});

Deno.test("resizeBoundary explorer-tabs sets the explorer's share of the pane", () => {
  const v = resizeBoundary(createInitialView(), "explorer-tabs", 30);
  assertEquals(v.explorer.widthPct, 30);
  // clamped to MIN_WIDTH_PCT at the edges
  assertEquals(
    resizeBoundary(v, "explorer-tabs", 2).explorer.widthPct,
    MIN_WIDTH_PCT,
  );
});

Deno.test("setExplorerHidden toggles the explorer flag without touching widths", () => {
  const hidden = setExplorerHidden(createInitialView(), true);
  assertEquals(hidden.explorer, { widthPct: 50, hidden: true });
  assertEquals(setExplorerHidden(hidden, false).explorer.hidden, false);
});

Deno.test("gridTemplateColumns lists chat, splitter and the pane when open", () => {
  assertEquals(gridTemplateColumns(createInitialView()), "60fr 6px 40fr");
});

Deno.test("gridTemplateColumns gives the collapsed pane no space", () => {
  const v = toggleCollapse(createInitialView(), "right");
  assertEquals(gridTemplateColumns(v), "100fr");
});

Deno.test("fixedPx counts the pane splitter when open, nothing when collapsed", () => {
  assertEquals(fixedPx(createInitialView()), 6);
  assertEquals(fixedPx(toggleCollapse(createInitialView(), "right")), 0);
});

Deno.test("collapsing the pane hands its width to chat and remembers it", () => {
  const v = toggleCollapse(createInitialView(), "right");
  assertEquals(v.right.collapsed, true);
  assertEquals(v.right.widthPct, 0);
  assertEquals(v.right.savedWidthPct, 40);
  assertEquals(v.center.widthPct, 100);
  assertEquals(visibleIds(v), ["center"]);
});

Deno.test("expanding restores the original layout", () => {
  const collapsed = toggleCollapse(createInitialView(), "right");
  const v = toggleCollapse(collapsed, "right");
  assertEquals(v.right.collapsed, false);
  assertEquals(v.right.widthPct, 40);
  assertEquals(v.center.widthPct, 60);
});

Deno.test("createInitialView sets activeTabId to the first row of each column", () => {
  const v = createInitialView();
  assertEquals(v.center.activeTabId, "center-1");
  assertEquals(v.right.activeTabId, "right-1");
});

Deno.test("isViewState rejects a column whose activeTabId names no row", () => {
  const bad = createInitialView();
  bad.center.activeTabId = "center-999";
  assertEquals(isViewState(bad), false);
});

Deno.test("isViewState rejects a column missing activeTabId", () => {
  const bad = createInitialView() as unknown as Record<
    string,
    Record<string, unknown>
  >;
  delete bad.center.activeTabId;
  assertEquals(isViewState(bad), false);
});

Deno.test("addTab appends a tab to the right column and activates it", () => {
  const v = addTab(createInitialView(), "terminal");
  assertEquals(v.right.rows.length, 2);
  assertEquals(v.right.rows[1], {
    id: "right-2",
    title: "Terminal",
    kind: "terminal",
  });
  assertEquals(v.right.activeTabId, "right-2");
});

Deno.test("addTab picks the smallest free right-N id", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2
  v = addTab(v, "terminal"); // right-3
  assertEquals(v.right.rows.map((r) => r.id), [
    "right-1",
    "right-2",
    "right-3",
  ]);
});

Deno.test("setActiveTab switches the active right tab", () => {
  const two = addTab(createInitialView(), "terminal"); // right-2 active
  const v = setActiveTab(two, "right-1");
  assertEquals(v.right.activeTabId, "right-1");
});

Deno.test("setActiveTab is a no-op for an unknown tab id", () => {
  const v = createInitialView();
  assertEquals(setActiveTab(v, "right-999").right.activeTabId, "right-1");
});

Deno.test("closeTab removes a tab", () => {
  const two = addTab(createInitialView(), "terminal"); // right-1, right-2
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
  let v = addTab(createInitialView(), "terminal"); // right-2
  v = addTab(v, "terminal"); // right-3, active
  v = closeTab(v, "right-3");
  assertEquals(v.right.activeTabId, "right-2"); // previous neighbor
});

Deno.test("closeTab activates the next tab when the first (active) tab is closed", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2
  v = setActiveTab(v, "right-1"); // right-1 active
  v = closeTab(v, "right-1");
  assertEquals(v.right.rows.map((r) => r.id), ["right-2"]);
  assertEquals(v.right.activeTabId, "right-2"); // no previous, so next
});

Deno.test("closeTab leaves the active tab unchanged when closing a different tab", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2, active
  v = closeTab(v, "right-1");
  assertEquals(v.right.activeTabId, "right-2");
});

Deno.test("isViewState accepts a real view and rejects malformed shapes", () => {
  assertEquals(isViewState(createInitialView()), true);
  assertEquals(isViewState(null), false);
  assertEquals(isViewState({}), false);
  assertEquals(isViewState({ left: {}, center: {}, right: {} }), false);
  assertEquals(
    isViewState(JSON.parse(JSON.stringify(createInitialView()))),
    true,
  );
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
  assertEquals(tab.props, {
    argv: ["$EDITOR", "/home/ivy/workspace/pique/src/lib/layout.ts"],
    autoCloseOnExit: true,
    autoFocus: true,
  });
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
  assertEquals(tab.props, {
    path: "/home/ivy/workspace/pique/src/lib/layout.ts",
  });
});
