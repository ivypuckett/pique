import { assertEquals } from "@std/assert";
import {
  createInitialView,
  fixedPx,
  gridTemplateColumns,
  MIN_WIDTH_CH,
  moduleLabel,
  resizeBoundary,
  visibleIds,
} from "./layout.ts";
import {
  addDiffTab,
  addEditorTab,
  addTab,
  closeTab,
  focusAdjacentTab,
  focusTabAt,
  isViewState,
  setActiveTab,
  setExplorerHidden,
  toggleCollapse,
} from "./layout.ts";

Deno.test("createInitialView starts at chat 57ch, explorer 30ch, none collapsed", () => {
  const v = createInitialView();
  assertEquals(v.chatWidthCh, 57);
  assertEquals(v.explorer, { widthCh: 30, hidden: false });
  assertEquals([v.center.collapsed, v.right.collapsed], [false, false]);
});

Deno.test("center and right each have one row", () => {
  const v = createInitialView();
  assertEquals(v.center.rows.length, 1);
  assertEquals(v.right.rows.length, 1);
});

Deno.test("resizeBoundary sets chat's character width, leaving the pane to flex", () => {
  const v = resizeBoundary(createInitialView(), "center-right", 40, 100);
  assertEquals(v.chatWidthCh, 40);
});

Deno.test("resizeBoundary clamps both panes to MIN_WIDTH_CH", () => {
  const v = createInitialView();
  assertEquals(resizeBoundary(v, "center-right", 2, 100).chatWidthCh, MIN_WIDTH_CH);
  // the flexible pane keeps its minimum too: 100ch available leaves chat 90
  assertEquals(
    resizeBoundary(v, "center-right", 200, 100).chatWidthCh,
    100 - MIN_WIDTH_CH,
  );
});

Deno.test("resizeBoundary explorer-tabs sets the explorer's character width", () => {
  const v = resizeBoundary(createInitialView(), "explorer-tabs", 24, 100);
  assertEquals(v.explorer.widthCh, 24);
  // clamped to MIN_WIDTH_CH at the edges
  assertEquals(
    resizeBoundary(v, "explorer-tabs", 2, 100).explorer.widthCh,
    MIN_WIDTH_CH,
  );
});

Deno.test("setExplorerHidden toggles the explorer flag without touching widths", () => {
  const hidden = setExplorerHidden(createInitialView(), true);
  assertEquals(hidden.explorer, { widthCh: 30, hidden: true });
  assertEquals(setExplorerHidden(hidden, false).explorer.hidden, false);
});

Deno.test("gridTemplateColumns lists chat, splitter and the pane when open", () => {
  assertEquals(
    gridTemplateColumns(createInitialView()),
    "minmax(0, 57ch) 6px minmax(10ch, 1fr)",
  );
});

Deno.test("gridTemplateColumns gives the collapsed pane no space", () => {
  const v = toggleCollapse(createInitialView(), "right");
  assertEquals(gridTemplateColumns(v), "1fr");
});

Deno.test("fixedPx counts the pane splitter when open, nothing when collapsed", () => {
  assertEquals(fixedPx(createInitialView()), 6);
  assertEquals(fixedPx(toggleCollapse(createInitialView(), "right")), 0);
});

Deno.test("collapsing the pane leaves chat the only visible column", () => {
  const v = toggleCollapse(createInitialView(), "right");
  assertEquals(v.right.collapsed, true);
  assertEquals(visibleIds(v), ["center"]);
});

Deno.test("expanding restores the original layout", () => {
  const resized = resizeBoundary(createInitialView(), "center-right", 80, 200);
  const v = toggleCollapse(toggleCollapse(resized, "right"), "right");
  assertEquals(v.right.collapsed, false);
  assertEquals(v.chatWidthCh, 80); // the round trip keeps the width it was dragged to
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

Deno.test("addTab reveals the open kanban tab instead of adding a second", () => {
  let v = addTab(createInitialView(), "kanban"); // right-2
  v = addTab(v, "terminal"); // right-3, active — so the reveal has to move the active id
  v = addTab(v, "kanban");
  assertEquals(v.right.rows.map((r) => r.kind), ["terminal", "kanban", "terminal"]);
  assertEquals(v.right.activeTabId, "right-2");
});

Deno.test("addTab appends a second terminal", () => {
  const v = addTab(createInitialView(), "terminal"); // right-1 is already a terminal
  assertEquals(v.right.rows.map((r) => r.kind), ["terminal", "terminal"]);
  assertEquals(v.right.activeTabId, "right-2");
});

Deno.test("addTab ignores a path-scoped diff when revealing the git diff module", () => {
  const v = addTab(addDiffTab(createInitialView(), "src/a.ts"), "gitdiff");
  assertEquals(v.right.rows.map((r) => r.title), ["Terminal", "a.ts", "Git Diff"]);
  assertEquals(v.right.activeTabId, "right-3");
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

Deno.test("focusAdjacentTab moves the active tab and clamps at the ends", () => {
  let v = addTab(createInitialView(), "kanban"); // right-1, right-2 (active)
  v = addTab(v, "library"); // right-3, active
  assertEquals(focusAdjacentTab(v, 1).right.activeTabId, "right-3"); // clamped at the end
  v = focusAdjacentTab(v, -1);
  assertEquals(v.right.activeTabId, "right-2");
  v = focusAdjacentTab(v, -1);
  assertEquals(v.right.activeTabId, "right-1");
  assertEquals(focusAdjacentTab(v, -1).right.activeTabId, "right-1"); // clamped at the start
});

Deno.test("focusTabAt shows the nth tab and ignores a digit past the end", () => {
  let v = addTab(createInitialView(), "kanban"); // right-1, right-2
  v = addTab(v, "library"); // right-3, active
  assertEquals(focusTabAt(v, 1).right.activeTabId, "right-1");
  assertEquals(focusTabAt(v, 2).right.activeTabId, "right-2");
  assertEquals(focusTabAt(v, 9).right.activeTabId, "right-3"); // unchanged
});

Deno.test("focusAdjacentTab is a no-op on an empty column", () => {
  const empty = closeTab(createInitialView(), "right-1");
  assertEquals(focusAdjacentTab(empty, 1).right.activeTabId, "");
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

Deno.test("library is a module kind with a capitalised label", () => {
  assertEquals(moduleLabel("library"), "Library");
});

Deno.test("automatons gets a capitalized label from the fallback", () => {
  assertEquals(moduleLabel("automatons"), "Automatons");
});

Deno.test("addTab opens a Library tab titled Library", () => {
  const v = addTab(createInitialView(), "library");
  const tab = v.right.rows[v.right.rows.length - 1];
  assertEquals(tab.kind, "library");
  assertEquals(tab.title, "Library");
  assertEquals(v.right.activeTabId, tab.id);
});
