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
  activeTabId,
  addDiffTab,
  addEditorTab,
  addTab,
  closeTab,
  EXPLORER,
  focusAdjacentTab,
  focusTabAt,
  groupTabs,
  isViewState,
  migrateView,
  setActiveTab,
  setExplorerHidden,
  toggleCollapse,
  type ViewState,
} from "./layout.ts";

Deno.test("createInitialView starts at chat 57ch, explorer 30ch, none collapsed", () => {
  const v = createInitialView();
  assertEquals(v.chatWidthCh, 57);
  assertEquals(v.explorer, { widthCh: 30, hidden: false });
  assertEquals([v.center.collapsed, v.right.collapsed], [false, false]);
});

Deno.test("center has one row and the right pane one tab", () => {
  const v = createInitialView();
  assertEquals(v.center.rows.length, 1);
  assertEquals(v.right.tabs.length, 1);
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

Deno.test("createInitialView opens on its terminal tab", () => {
  const v = createInitialView();
  assertEquals(v.center.activeTabId, "center-1");
  assertEquals(v.right.activeGroup, "terminal");
  assertEquals(activeTabId(v), "right-1");
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

Deno.test("isViewState rejects a remembered tab that is in another group", () => {
  const bad = createInitialView();
  bad.right.activeTabs = { kanban: "right-1" }; // right-1 is a terminal
  assertEquals(isViewState(bad), false);
});

Deno.test("isViewState rejects a tab with no group and a pane with no selected group", () => {
  const noGroup = createInitialView() as unknown as {
    right: { tabs: Record<string, unknown>[]; activeGroup: string };
  };
  delete noGroup.right.tabs[0].group;
  assertEquals(isViewState(noGroup), false);
  const noSelection = createInitialView();
  noSelection.right.activeGroup = "";
  assertEquals(isViewState(noSelection), false);
});

Deno.test("addTab appends a tab in its own group and shows it", () => {
  const v = addTab(createInitialView(), "terminal");
  assertEquals(v.right.tabs.length, 2);
  assertEquals(v.right.tabs[1], {
    id: "right-2",
    title: "Terminal",
    kind: "terminal",
    group: "terminal",
  });
  assertEquals(v.right.activeGroup, "terminal");
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("addTab picks the smallest free right-N id across every group", () => {
  let v = addTab(createInitialView(), "kanban"); // right-2
  v = addTab(v, "terminal"); // right-3
  assertEquals(v.right.tabs.map((t) => t.id), [
    "right-1",
    "right-2",
    "right-3",
  ]);
});

Deno.test("addTab selects the group it opens", () => {
  const v = addTab(createInitialView(), "kanban");
  assertEquals(v.right.activeGroup, "kanban");
  assertEquals(activeTabId(v), "right-2");
  // the terminal group is still open behind it, on the tab it was showing
  assertEquals(v.right.activeTabs, { terminal: "right-1", kanban: "right-2" });
});

Deno.test("addTab reveals the open kanban tab instead of adding a second", () => {
  let v = addTab(createInitialView(), "kanban"); // right-2
  v = addTab(v, "terminal"); // right-3, and the terminal group is selected
  v = addTab(v, "kanban");
  assertEquals(v.right.tabs.map((t) => t.kind), ["terminal", "kanban", "terminal"]);
  assertEquals(v.right.activeGroup, "kanban");
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("addTab appends a second terminal", () => {
  const v = addTab(createInitialView(), "terminal"); // right-1 is already a terminal
  assertEquals(groupTabs(v, "terminal").map((t) => t.id), ["right-1", "right-2"]);
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("addTab ignores a path-scoped diff when opening the git diff module", () => {
  // The diff from the tree is in the explorer group, so it is not the Git Diff module
  // and cannot be revealed in its place.
  const v = addTab(addDiffTab(createInitialView(), "src/a.ts"), "gitdiff");
  assertEquals(v.right.tabs.map((t) => [t.title, t.group]), [
    ["Terminal", "terminal"],
    ["a.ts", EXPLORER],
    ["Git Diff", "gitdiff"],
  ]);
  assertEquals(v.right.activeGroup, "gitdiff");
  assertEquals(activeTabId(v), "right-3");
});

Deno.test("groupTabs lists one group's tabs, in open order", () => {
  let v = addTab(createInitialView(), "kanban");
  v = addTab(v, "terminal");
  assertEquals(groupTabs(v, "terminal").map((t) => t.id), ["right-1", "right-3"]);
  assertEquals(groupTabs(v, "kanban").map((t) => t.id), ["right-2"]);
  assertEquals(groupTabs(v, "library"), []);
  // no group argument means the selected one
  assertEquals(groupTabs(v).map((t) => t.id), ["right-1", "right-3"]);
});

Deno.test("setActiveTab switches the shown tab", () => {
  const two = addTab(createInitialView(), "terminal"); // right-2 shown
  const v = setActiveTab(two, "right-1");
  assertEquals(activeTabId(v), "right-1");
});

Deno.test("setActiveTab is a no-op for an unknown tab id", () => {
  const v = createInitialView();
  assertEquals(activeTabId(setActiveTab(v, "right-999")), "right-1");
});

Deno.test("setActiveTab selects the tab's group when it is not the current one", () => {
  let v = addTab(createInitialView(), "kanban"); // kanban selected
  v = setActiveTab(v, "right-1"); // a terminal
  assertEquals(v.right.activeGroup, "terminal");
  assertEquals(activeTabId(v), "right-1");
});

Deno.test("a group remembers its tab across a switch away and back", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2 shown of two terminals
  v = addTab(v, "kanban"); // right-3, kanban selected
  v = setActiveTab(v, "right-2"); // back to the terminals
  assertEquals(activeTabId(v), "right-2");
  v = addTab(v, "kanban"); // reveal kanban again
  assertEquals(activeTabId(v), "right-3");
  v = addTab(v, "terminal"); // a third terminal, so the group is selected again
  assertEquals(v.right.activeGroup, "terminal");
});

Deno.test("focusAdjacentTab moves along the group's strip and clamps at the ends", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2
  v = addTab(v, "terminal"); // right-3, shown
  assertEquals(activeTabId(focusAdjacentTab(v, 1)), "right-3"); // clamped at the end
  v = focusAdjacentTab(v, -1);
  assertEquals(activeTabId(v), "right-2");
  v = focusAdjacentTab(v, -1);
  assertEquals(activeTabId(v), "right-1");
  assertEquals(activeTabId(focusAdjacentTab(v, -1)), "right-1"); // clamped at the start
});

Deno.test("focusAdjacentTab skips the tabs of other groups", () => {
  let v = addTab(createInitialView(), "kanban"); // right-2, between the two terminals
  v = addTab(v, "terminal"); // right-3, shown
  assertEquals(activeTabId(focusAdjacentTab(v, -1)), "right-1"); // not the kanban tab
});

Deno.test("focusTabAt shows the nth tab of the group and ignores a digit past the end", () => {
  let v = addTab(createInitialView(), "kanban"); // right-2, not on the terminal strip
  v = addTab(v, "terminal"); // right-3
  v = addTab(v, "terminal"); // right-4, shown
  assertEquals(activeTabId(focusTabAt(v, 1)), "right-1");
  assertEquals(activeTabId(focusTabAt(v, 2)), "right-3"); // the strip's second, not right-2
  assertEquals(activeTabId(focusTabAt(v, 9)), "right-4"); // unchanged
});

Deno.test("focusAdjacentTab is a no-op on an empty group", () => {
  const empty = closeTab(createInitialView(), "right-1");
  assertEquals(activeTabId(focusAdjacentTab(empty, 1)), "");
});

Deno.test("closeTab removes a tab", () => {
  const two = addTab(createInitialView(), "terminal"); // right-1, right-2
  const v = closeTab(two, "right-2");
  assertEquals(v.right.tabs.map((t) => t.id), ["right-1"]);
});

Deno.test("closeTab empties the group but leaves it selected", () => {
  const closed = closeTab(createInitialView(), "right-1");
  assertEquals(closed.right.tabs.length, 0);
  assertEquals(closed.right.activeGroup, "terminal");
  assertEquals(closed.right.activeTabs, {}); // an empty group remembers nothing
  assertEquals(activeTabId(closed), "");
});

Deno.test("closeTab shows the previous tab of the group when the shown one is closed", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2
  v = addTab(v, "terminal"); // right-3, shown
  v = closeTab(v, "right-3");
  assertEquals(activeTabId(v), "right-2"); // previous neighbor
});

Deno.test("closeTab shows the next tab of the group when the first one is closed", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2
  v = setActiveTab(v, "right-1"); // right-1 shown
  v = closeTab(v, "right-1");
  assertEquals(v.right.tabs.map((t) => t.id), ["right-2"]);
  assertEquals(activeTabId(v), "right-2"); // no previous, so next
});

Deno.test("closeTab picks the neighbor from the same group, not the strip beside it", () => {
  let v = addTab(createInitialView(), "kanban"); // right-2
  v = addTab(v, "terminal"); // right-3, shown
  v = closeTab(v, "right-3");
  assertEquals(activeTabId(v), "right-1"); // the other terminal, not the kanban tab
});

Deno.test("closeTab leaves the shown tab unchanged when closing a different one", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2, shown
  v = closeTab(v, "right-1");
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("closeTab leaves another group's memory alone", () => {
  let v = addTab(createInitialView(), "kanban"); // right-2
  v = closeTab(v, "right-1"); // empties the terminal group
  assertEquals(v.right.activeTabs, { kanban: "right-2" });
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
  // the pane is valid with zero tabs — closing every tab empties it
  const noTabs = createInitialView();
  noTabs.right.tabs = [];
  noTabs.right.activeTabs = {};
  assertEquals(isViewState(noTabs), true);
});

Deno.test("addEditorTab adds a terminal tab in the explorer group, titled with the basename", () => {
  const v = createInitialView();
  const before = v.right.tabs.length;
  const next = addEditorTab(v, "/home/ivy/workspace/pique/src/lib/layout.ts");
  assertEquals(next.right.tabs.length, before + 1);
  const tab = next.right.tabs.at(-1)!;
  assertEquals(tab.kind, "terminal");
  assertEquals(tab.group, EXPLORER);
  assertEquals(tab.title, "layout.ts");
  assertEquals(next.right.activeGroup, EXPLORER);
  assertEquals(activeTabId(next), tab.id);
  assertEquals(tab.props, {
    argv: ["$EDITOR", "/home/ivy/workspace/pique/src/lib/layout.ts"],
    autoCloseOnExit: true,
    autoFocus: true,
  });
});

Deno.test("addEditorTab falls back to the full path when there is no basename", () => {
  const tab = addEditorTab(createInitialView(), "/").right.tabs.at(-1)!;
  assertEquals(tab.title, "/");
});

Deno.test("editors stack up in the explorer group beside the tree", () => {
  let v = addEditorTab(createInitialView(), "src/a.ts");
  v = addEditorTab(v, "src/b.ts");
  assertEquals(groupTabs(v, EXPLORER).map((t) => t.title), ["a.ts", "b.ts"]);
  assertEquals(groupTabs(v, "terminal").length, 1); // the shell is untouched
});

Deno.test("addDiffTab adds a gitdiff tab in the explorer group, scoped to the file path", () => {
  const v = createInitialView();
  const before = v.right.tabs.length;
  const next = addDiffTab(v, "/home/ivy/workspace/pique/src/lib/layout.ts");
  assertEquals(next.right.tabs.length, before + 1);
  const tab = next.right.tabs.at(-1)!;
  assertEquals(tab.kind, "gitdiff");
  assertEquals(tab.group, EXPLORER);
  assertEquals(tab.title, "layout.ts");
  assertEquals(next.right.activeGroup, EXPLORER);
  assertEquals(activeTabId(next), tab.id);
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
  const tab = v.right.tabs.at(-1)!;
  assertEquals(tab.kind, "library");
  assertEquals(tab.title, "Library");
  assertEquals(activeTabId(v), tab.id);
});

// A view as it was persisted before the right pane had groups: one flat `rows` list with
// a single `activeTabId`, and the explorer's width and hidden flag beside it.
function oldView(
  rows: Record<string, unknown>[],
  activeTabId: string,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    id: "view-1",
    chatWidthCh: 80,
    center: {
      collapsed: false,
      activeTabId: "center-1",
      rows: [{ id: "center-1", title: "Chat", kind: "chat" }],
    },
    right: { collapsed: false, activeTabId, rows },
    explorer: { widthCh: 24, hidden: true },
    ...extra,
  };
}

Deno.test("migrateView returns a view that is already grouped untouched", () => {
  const v = createInitialView();
  assertEquals(migrateView(v), v);
});

Deno.test("migrateView groups a pre-groups pane by kind and keeps the shown tab", () => {
  const v = migrateView(oldView([
    { id: "right-1", title: "Terminal", kind: "terminal" },
    { id: "right-2", title: "Kanban", kind: "kanban" },
    { id: "right-3", title: "Terminal", kind: "terminal" },
  ], "right-2"))!;
  assertEquals(v.right.tabs.map((t) => [t.id, t.group]), [
    ["right-1", "terminal"],
    ["right-2", "kanban"],
    ["right-3", "terminal"],
  ]);
  assertEquals(v.right.activeGroup, "kanban");
  assertEquals(activeTabId(v), "right-2");
  // every other group opens on its first tab
  assertEquals(v.right.activeTabs, { kanban: "right-2", terminal: "right-1" });
  // and the rest of the view survives
  assertEquals(v.id, "view-1");
  assertEquals(v.chatWidthCh, 80);
  assertEquals(v.explorer, { widthCh: 24, hidden: true });
});

Deno.test("migrateView keeps the first of a singleton kind that was duplicated", () => {
  const v = migrateView(oldView([
    { id: "right-1", title: "Kanban", kind: "kanban" },
    { id: "right-2", title: "Kanban", kind: "kanban" },
    { id: "right-3", title: "Kanban", kind: "kanban" },
  ], "right-3"))!;
  assertEquals(v.right.tabs.map((t) => t.id), ["right-1"]);
  assertEquals(v.right.activeGroup, "kanban");
  // the tab that was on screen is gone, so the group falls back to the one that is left
  assertEquals(activeTabId(v), "right-1");
});

Deno.test("migrateView moves editors and path-scoped diffs into the explorer group", () => {
  const v = migrateView(oldView([
    { id: "right-1", title: "Terminal", kind: "terminal" },
    {
      id: "right-2",
      title: "a.ts",
      kind: "terminal",
      props: { argv: ["$EDITOR", "src/a.ts"], autoCloseOnExit: true },
    },
    { id: "right-3", title: "b.ts", kind: "gitdiff", props: { path: "src/b.ts" } },
  ], "right-2"))!;
  assertEquals(groupTabs(v, EXPLORER).map((t) => t.title), ["a.ts", "b.ts"]);
  assertEquals(groupTabs(v, "terminal").map((t) => t.id), ["right-1"]);
  assertEquals(v.right.activeGroup, EXPLORER);
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("migrateView keeps a pane that was collapsed collapsed", () => {
  const raw = oldView([{ id: "right-1", title: "Terminal", kind: "terminal" }], "right-1");
  (raw as { right: { collapsed: boolean } }).right.collapsed = true;
  assertEquals(migrateView(raw)!.right.collapsed, true);
});

Deno.test("migrateView selects a group for a pane migrated with no tabs at all", () => {
  const v = migrateView(oldView([], ""))!;
  assertEquals(v.right.tabs, []);
  assertEquals(v.right.activeGroup, "terminal");
  assertEquals(activeTabId(v), "");
});

Deno.test("migrateView refuses a view with no recognisable pane", () => {
  assertEquals(migrateView(null), null);
  assertEquals(migrateView({}), null);
  assertEquals(migrateView({ right: { rows: "nope" } }), null);
  assertEquals(migrateView({ right: { rows: [{ id: 1 }] } }), null);
});

Deno.test("migrateView fills in a width or an explorer it cannot read", () => {
  const base = createInitialView();
  const raw = oldView([{ id: "right-1", title: "Terminal", kind: "terminal" }], "right-1") as
    Record<string, unknown>;
  delete raw.chatWidthCh;
  raw.explorer = { widthCh: "wide" };
  const v = migrateView(raw)!;
  assertEquals(v.chatWidthCh, base.chatWidthCh);
  assertEquals(v.explorer, base.explorer);
});

Deno.test("a migrated view passes the guard the store uses", () => {
  const v: ViewState = migrateView(oldView([
    { id: "right-1", title: "Terminal", kind: "terminal" },
    { id: "right-2", title: "Library", kind: "library" },
  ], "right-1"))!;
  assertEquals(isViewState(v), true);
});
