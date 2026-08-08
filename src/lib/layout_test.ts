import { assertEquals } from "@std/assert";
import {
  createInitialView,
  gridTemplateColumns,
  MIN_WIDTH_CH,
  moduleLabel,
  resizeBoundary,
} from "./layout.ts";
import {
  activeTabId,
  addDiffTab,
  addEditorTab,
  addTab,
  closeTab,
  EXPLORER,
  focusAdjacentGroup,
  focusAdjacentTab,
  focusTabAt,
  groupTabs,
  isViewState,
  migrateView,
  newTab,
  selectGroup,
  setActiveTab,
  type ViewState,
} from "./layout.ts";

Deno.test("createInitialView starts at chat 57ch, tree 30ch", () => {
  const v = createInitialView();
  assertEquals(v.chatWidthCh, 57);
  assertEquals(v.explorerWidthCh, 30);
});

Deno.test("the right pane starts on one tab", () => {
  assertEquals(createInitialView().right.tabs.length, 1);
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

Deno.test("resizeBoundary explorer-tabs sets the file tree's character width", () => {
  const v = resizeBoundary(createInitialView(), "explorer-tabs", 24, 100);
  assertEquals(v.explorerWidthCh, 24);
  // clamped to MIN_WIDTH_CH at the edges
  assertEquals(
    resizeBoundary(v, "explorer-tabs", 2, 100).explorerWidthCh,
    MIN_WIDTH_CH,
  );
});

Deno.test("gridTemplateColumns lists chat, splitter and the pane", () => {
  assertEquals(
    gridTemplateColumns(createInitialView()),
    "minmax(0, 57ch) 6px minmax(10ch, 1fr)",
  );
  // Hiding the module rail is a component-level concern (moduleRailHidden), so the row
  // keeps both columns whatever is on screen inside the pane.
  const resized = resizeBoundary(createInitialView(), "center-right", 80, 200);
  assertEquals(
    gridTemplateColumns(resized),
    "minmax(0, 80ch) 6px minmax(10ch, 1fr)",
  );
});

Deno.test("createInitialView opens on its terminal tab", () => {
  const v = createInitialView();
  assertEquals(v.right.activeGroup, "terminal");
  assertEquals(activeTabId(v), "right-1");
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

Deno.test("newTab adds one more of the selected row's module", () => {
  const v = newTab(createInitialView()); // the terminal row
  assertEquals(groupTabs(v, "terminal").map((t) => t.id), ["right-1", "right-2"]);
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("newTab does nothing on a row that may only hold one", () => {
  const v = addTab(createInitialView(), "kanban"); // kanban selected
  assertEquals(newTab(v), v);
});

Deno.test("newTab does nothing on the explorer row — its tabs come from the tree", () => {
  const v = selectGroup(createInitialView(), EXPLORER);
  assertEquals(newTab(v), v);
});

Deno.test("selectGroup shows an open group without opening anything", () => {
  let v = addTab(createInitialView(), "kanban"); // kanban selected, right-2
  v = addTab(v, "terminal"); // right-3, terminals selected
  const back = selectGroup(v, "kanban");
  assertEquals(back.right.activeGroup, "kanban");
  assertEquals(back.right.tabs.length, v.right.tabs.length); // nothing opened
  assertEquals(activeTabId(back), "right-2");
});

Deno.test("selectGroup opens the module when its row is empty", () => {
  const v = selectGroup(createInitialView(), "library");
  assertEquals(v.right.activeGroup, "library");
  assertEquals(groupTabs(v, "library").map((t) => t.title), ["Library"]);
});

Deno.test("selectGroup selects the empty explorer row rather than opening a module", () => {
  const v = selectGroup(createInitialView(), EXPLORER);
  assertEquals(v.right.activeGroup, EXPLORER);
  assertEquals(v.right.tabs.length, 1); // just the terminal it started with
  assertEquals(activeTabId(v), "");
});

Deno.test("selectGroup ignores a row that is not a module", () => {
  const v = createInitialView();
  assertEquals(selectGroup(v, "nonsense"), v);
});

Deno.test("selectGroup reopens a module whose last tab was closed", () => {
  let v = addTab(createInitialView(), "kanban");
  v = closeTab(v, activeTabId(v));
  v = selectGroup(v, "kanban");
  assertEquals(groupTabs(v, "kanban").length, 1);
});

Deno.test("focusAdjacentGroup walks the rail and clamps at both ends", () => {
  // rail order: explorer, terminal, gitdiff, kanban, library, automatons
  let v = createInitialView(); // terminal selected
  v = focusAdjacentGroup(v, -1);
  assertEquals(v.right.activeGroup, EXPLORER);
  assertEquals(focusAdjacentGroup(v, -1).right.activeGroup, EXPLORER); // clamped at the top
  v = focusAdjacentGroup(v, 1);
  assertEquals(v.right.activeGroup, "terminal");
  v = focusAdjacentGroup(v, 1);
  assertEquals(v.right.activeGroup, "gitdiff");
  for (let i = 0; i < 9; i++) v = focusAdjacentGroup(v, 1);
  assertEquals(v.right.activeGroup, "automatons"); // clamped at the bottom
});

Deno.test("focusAdjacentGroup opens nothing on the way past an empty row", () => {
  const v = focusAdjacentGroup(createInitialView(), 1); // onto the empty gitdiff row
  assertEquals(v.right.activeGroup, "gitdiff");
  assertEquals(v.right.tabs.length, 1);
  assertEquals(activeTabId(v), "");
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

Deno.test("closeTab refuses to close a singleton row's module", () => {
  const v = addTab(createInitialView(), "kanban"); // kanban selected, right-2
  assertEquals(closeTab(v, "right-2"), v); // the row IS the module; nothing to close
});

Deno.test("closeTab still closes a file open in the explorer row", () => {
  const v = addEditorTab(createInitialView(), "src/a.ts"); // a terminal, group explorer
  const closed = closeTab(v, activeTabId(v));
  assertEquals(groupTabs(closed, EXPLORER), []);
  assertEquals(closed.right.activeGroup, EXPLORER); // the row stays selected, tree and all
});

Deno.test("closeTab still closes a path-scoped diff in the explorer row", () => {
  const v = addDiffTab(createInitialView(), "src/a.ts"); // a gitdiff, group explorer
  assertEquals(groupTabs(closeTab(v, activeTabId(v)), EXPLORER), []);
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
  assertEquals(v.explorerWidthCh, 24); // carried out of the old explorer object
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

Deno.test("migrateView selects a group for a pane migrated with no tabs at all", () => {
  const v = migrateView(oldView([], ""))!;
  assertEquals(v.right.tabs, []);
  assertEquals(v.right.activeGroup, "terminal");
  assertEquals(activeTabId(v), "");
});

// A view as persisted between grouping the pane and moving the tree into the explorer
// row: `right` is already grouped, but the tree's width still sits in an `explorer`
// object. Rejecting this shape cost the app every workspace it read.
function groupedView(right: Record<string, unknown>): unknown {
  return {
    id: "view-1",
    chatWidthCh: 57,
    center: {
      collapsed: false,
      activeTabId: "center-1",
      rows: [{ id: "center-1", title: "Chat", kind: "chat", group: "chat" }],
    },
    right,
    explorer: { widthCh: 42, hidden: false },
  };
}

Deno.test("migrateView adopts a grouped pane whose width is still in an explorer object", () => {
  const v = migrateView(groupedView({
    collapsed: false,
    activeGroup: "kanban",
    tabs: [
      { id: "right-1", title: "Terminal", kind: "terminal", group: "terminal" },
      { id: "right-2", title: "Kanban", kind: "kanban", group: "kanban" },
      { id: "right-3", title: "a.ts", kind: "terminal", group: EXPLORER, props: { path: "a" } },
    ],
    activeTabs: { terminal: "right-1", kanban: "right-2", explorer: "right-3" },
  }))!;
  assertEquals(v.right.tabs.map((t) => [t.id, t.group]), [
    ["right-1", "terminal"],
    ["right-2", "kanban"],
    ["right-3", EXPLORER],
  ]);
  assertEquals(v.right.activeGroup, "kanban"); // the selected row is kept, not re-derived
  assertEquals(v.right.activeTabs, {
    terminal: "right-1",
    kanban: "right-2",
    explorer: "right-3",
  });
  assertEquals(v.explorerWidthCh, 42); // carried out of the old explorer object
  assertEquals(isViewState(v), true);
});

Deno.test("migrateView drops a remembered tab that no longer exists or moved group", () => {
  const v = migrateView(groupedView({
    collapsed: false,
    activeGroup: "terminal",
    tabs: [{ id: "right-1", title: "Terminal", kind: "terminal", group: "terminal" }],
    activeTabs: { terminal: "right-1", kanban: "right-9", library: "right-1" },
  }))!;
  assertEquals(v.right.activeTabs, { terminal: "right-1" });
  assertEquals(isViewState(v), true);
});

Deno.test("migrateView keeps a grouped pane's selected row even with nothing open in it", () => {
  const v = migrateView(groupedView({
    collapsed: false,
    activeGroup: "library",
    tabs: [],
    activeTabs: {},
  }))!;
  assertEquals(v.right.activeGroup, "library");
  assertEquals(activeTabId(v), "");
});

Deno.test("migrateView refuses a view with no recognisable pane", () => {
  assertEquals(migrateView(null), null);
  assertEquals(migrateView({}), null);
  assertEquals(migrateView({ right: { rows: "nope" } }), null);
  assertEquals(migrateView({ right: { rows: [{ id: 1 }] } }), null);
});

Deno.test("migrateView fills in a width it cannot read", () => {
  const base = createInitialView();
  const raw = oldView([{ id: "right-1", title: "Terminal", kind: "terminal" }], "right-1") as
    Record<string, unknown>;
  delete raw.chatWidthCh;
  raw.explorer = { widthCh: "wide" };
  const v = migrateView(raw)!;
  assertEquals(v.chatWidthCh, base.chatWidthCh);
  assertEquals(v.explorerWidthCh, base.explorerWidthCh);
});

Deno.test("a migrated view passes the guard the store uses", () => {
  const v: ViewState = migrateView(oldView([
    { id: "right-1", title: "Terminal", kind: "terminal" },
    { id: "right-2", title: "Library", kind: "library" },
  ], "right-1"))!;
  assertEquals(isViewState(v), true);
});
