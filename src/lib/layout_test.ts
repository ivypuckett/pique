import { assertEquals } from "@std/assert";
import { setInstalledModules } from "./modules/manifest.ts";
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
  EDITOR,
  focusAdjacentGroup,
  focusAdjacentTab,
  focusTabAt,
  groupTabs,
  adoptView,
  isViewState,
  newTab,
  selectGroup,
  setActiveTab,
  type ViewState,
} from "./layout.ts";

Deno.test("createInitialView starts at chat 57ch, tree 30ch", () => {
  const v = createInitialView();
  assertEquals(v.chatWidthCh, 57);
  assertEquals(v.editorWidthCh, 30);
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
  assertEquals(
    resizeBoundary(v, "center-right", 2, 100).chatWidthCh,
    MIN_WIDTH_CH,
  );
  // the flexible pane keeps its minimum too: 100ch available leaves chat 90
  assertEquals(
    resizeBoundary(v, "center-right", 200, 100).chatWidthCh,
    100 - MIN_WIDTH_CH,
  );
});

Deno.test("resizeBoundary editor-tabs sets the file tree's character width", () => {
  const v = resizeBoundary(createInitialView(), "editor-tabs", 24, 100);
  assertEquals(v.editorWidthCh, 24);
  // clamped to MIN_WIDTH_CH at the edges
  assertEquals(
    resizeBoundary(v, "editor-tabs", 2, 100).editorWidthCh,
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
  bad.right.activeTabs = { gitdiff: "right-1" }; // right-1 is a terminal
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
  let v = addTab(createInitialView(), "gitdiff"); // right-2
  v = addTab(v, "terminal"); // right-3
  assertEquals(v.right.tabs.map((t) => t.id), [
    "right-1",
    "right-2",
    "right-3",
  ]);
});

Deno.test("addTab selects the group it opens", () => {
  const v = addTab(createInitialView(), "gitdiff");
  assertEquals(v.right.activeGroup, "gitdiff");
  assertEquals(activeTabId(v), "right-2");
  // the terminal group is still open behind it, on the tab it was showing
  assertEquals(v.right.activeTabs, { terminal: "right-1", gitdiff: "right-2" });
});

Deno.test("addTab reveals the open gitdiff tab instead of adding a second", () => {
  let v = addTab(createInitialView(), "gitdiff"); // right-2
  v = addTab(v, "terminal"); // right-3, and the terminal group is selected
  v = addTab(v, "gitdiff");
  assertEquals(v.right.tabs.map((t) => t.kind), [
    "terminal",
    "gitdiff",
    "terminal",
  ]);
  assertEquals(v.right.activeGroup, "gitdiff");
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("addTab appends a second terminal", () => {
  const v = addTab(createInitialView(), "terminal"); // right-1 is already a terminal
  assertEquals(groupTabs(v, "terminal").map((t) => t.id), [
    "right-1",
    "right-2",
  ]);
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("addTab ignores a path-scoped diff when opening the git diff module", () => {
  // The diff from the tree is in the editor group, so it is not the Git Diff module
  // and cannot be revealed in its place.
  const v = addTab(addDiffTab(createInitialView(), "src/a.ts"), "gitdiff");
  assertEquals(v.right.tabs.map((t) => [t.title, t.group]), [
    ["Terminal", "terminal"],
    ["a.ts", EDITOR],
    ["Git Diff", "gitdiff"],
  ]);
  assertEquals(v.right.activeGroup, "gitdiff");
  assertEquals(activeTabId(v), "right-3");
});

Deno.test("groupTabs lists one group's tabs, in open order", () => {
  let v = addTab(createInitialView(), "gitdiff");
  v = addTab(v, "terminal");
  assertEquals(groupTabs(v, "terminal").map((t) => t.id), [
    "right-1",
    "right-3",
  ]);
  assertEquals(groupTabs(v, "gitdiff").map((t) => t.id), ["right-2"]);
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
  let v = addTab(createInitialView(), "gitdiff"); // gitdiff selected
  v = setActiveTab(v, "right-1"); // a terminal
  assertEquals(v.right.activeGroup, "terminal");
  assertEquals(activeTabId(v), "right-1");
});

Deno.test("a group remembers its tab across a switch away and back", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2 shown of two terminals
  v = addTab(v, "gitdiff"); // right-3, gitdiff selected
  v = setActiveTab(v, "right-2"); // back to the terminals
  assertEquals(activeTabId(v), "right-2");
  v = addTab(v, "gitdiff"); // reveal gitdiff again
  assertEquals(activeTabId(v), "right-3");
  v = addTab(v, "terminal"); // a third terminal, so the group is selected again
  assertEquals(v.right.activeGroup, "terminal");
});

Deno.test("newTab adds one more of the selected row's module", () => {
  const v = newTab(createInitialView()); // the terminal row
  assertEquals(groupTabs(v, "terminal").map((t) => t.id), [
    "right-1",
    "right-2",
  ]);
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("newTab does nothing on a row that may only hold one", () => {
  const v = addTab(createInitialView(), "gitdiff"); // gitdiff selected
  assertEquals(newTab(v), v);
});

Deno.test("newTab does nothing on the editor row — its tabs come from the tree", () => {
  const v = selectGroup(createInitialView(), EDITOR);
  assertEquals(newTab(v), v);
});

Deno.test("selectGroup shows an open group without opening anything", () => {
  let v = addTab(createInitialView(), "gitdiff"); // gitdiff selected, right-2
  v = addTab(v, "terminal"); // right-3, terminals selected
  const back = selectGroup(v, "gitdiff");
  assertEquals(back.right.activeGroup, "gitdiff");
  assertEquals(back.right.tabs.length, v.right.tabs.length); // nothing opened
  assertEquals(activeTabId(back), "right-2");
});

Deno.test("selectGroup opens the module when its row is empty", () => {
  const v = selectGroup(createInitialView(), "library");
  assertEquals(v.right.activeGroup, "library");
  assertEquals(groupTabs(v, "library").map((t) => t.title), ["Library"]);
});

Deno.test("selectGroup selects the empty editor row rather than opening a module", () => {
  const v = selectGroup(createInitialView(), EDITOR);
  assertEquals(v.right.activeGroup, EDITOR);
  assertEquals(v.right.tabs.length, 1); // just the terminal it started with
  assertEquals(activeTabId(v), "");
});

Deno.test("selectGroup ignores a row that is not a module", () => {
  const v = createInitialView();
  assertEquals(selectGroup(v, "nonsense"), v);
});

Deno.test("selectGroup reopens a module whose last tab was closed", () => {
  let v = addTab(createInitialView(), "gitdiff");
  v = closeTab(v, activeTabId(v));
  v = selectGroup(v, "gitdiff");
  assertEquals(groupTabs(v, "gitdiff").length, 1);
});

Deno.test("focusAdjacentGroup walks the rail and clamps at both ends", () => {
  // rail order: editor, terminal, gitdiff, library
  let v = createInitialView(); // terminal selected
  v = focusAdjacentGroup(v, -1);
  assertEquals(v.right.activeGroup, EDITOR);
  assertEquals(focusAdjacentGroup(v, -1).right.activeGroup, EDITOR); // clamped at the top
  v = focusAdjacentGroup(v, 1);
  assertEquals(v.right.activeGroup, "terminal");
  v = focusAdjacentGroup(v, 1);
  assertEquals(v.right.activeGroup, "gitdiff");
  for (let i = 0; i < 9; i++) v = focusAdjacentGroup(v, 1);
  assertEquals(v.right.activeGroup, "library"); // clamped at the bottom
});

Deno.test("focusAdjacentGroup opens the module of the row it lands on", () => {
  const v = focusAdjacentGroup(createInitialView(), 1); // onto the empty gitdiff row
  assertEquals(v.right.activeGroup, "gitdiff");
  assertEquals(groupTabs(v, "gitdiff").map((t) => t.title), ["Git Diff"]);
});

Deno.test("focusAdjacentGroup shows an already-open row without opening a second", () => {
  let v = addTab(createInitialView(), "gitdiff"); // right-2, gitdiff selected
  v = focusAdjacentGroup(v, -1); // back onto the terminal row
  v = focusAdjacentGroup(v, 1); // and onto gitdiff again
  assertEquals(groupTabs(v, "gitdiff").map((t) => t.id), ["right-2"]);
});

Deno.test("focusAdjacentGroup opens nothing on the editor row", () => {
  const v = focusAdjacentGroup(createInitialView(), -1); // onto the editor row
  assertEquals(v.right.activeGroup, EDITOR);
  assertEquals(v.right.tabs.length, 1); // just the terminal it started with
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
  let v = addTab(createInitialView(), "gitdiff"); // right-2, between the two terminals
  v = addTab(v, "terminal"); // right-3, shown
  assertEquals(activeTabId(focusAdjacentTab(v, -1)), "right-1"); // not the gitdiff tab
});

Deno.test("focusTabAt shows the nth tab of the group and ignores a digit past the end", () => {
  let v = addTab(createInitialView(), "gitdiff"); // right-2, not on the terminal strip
  v = addTab(v, "terminal"); // right-3
  v = addTab(v, "terminal"); // right-4, shown
  assertEquals(activeTabId(focusTabAt(v, 1)), "right-1");
  assertEquals(activeTabId(focusTabAt(v, 2)), "right-3"); // the strip's second, not right-2
  assertEquals(activeTabId(focusTabAt(v, 9)), "right-4"); // unchanged
});

Deno.test("focusAdjacentTab is a no-op on an empty group", () => {
  const empty = selectGroup(createInitialView(), EDITOR); // no files open beside the tree
  assertEquals(activeTabId(focusAdjacentTab(empty, 1)), "");
});

Deno.test("closeTab refuses to close a singleton row's module", () => {
  const v = addTab(createInitialView(), "gitdiff"); // gitdiff selected, right-2
  assertEquals(closeTab(v, "right-2"), v); // the row IS the module; nothing to close
});

Deno.test("closeTab still closes a file open in the editor row", () => {
  const v = addEditorTab(createInitialView(), "src/a.ts"); // a terminal, group editor
  const closed = closeTab(v, activeTabId(v));
  assertEquals(groupTabs(closed, EDITOR), []);
  assertEquals(closed.right.activeGroup, EDITOR); // the row stays selected, tree and all
});

Deno.test("closeTab still closes a path-scoped diff in the editor row", () => {
  const v = addDiffTab(createInitialView(), "src/a.ts"); // a gitdiff, group editor
  assertEquals(groupTabs(closeTab(v, activeTabId(v)), EDITOR), []);
});

Deno.test("closeTab removes a tab", () => {
  const two = addTab(createInitialView(), "terminal"); // right-1, right-2
  const v = closeTab(two, "right-2");
  assertEquals(v.right.tabs.map((t) => t.id), ["right-1"]);
});

Deno.test("closeTab replaces a module row's last tab with a fresh one", () => {
  const closed = closeTab(createInitialView(), "right-1");
  assertEquals(closed.right.activeGroup, "terminal");
  // A new tab, not the one that was closed: the old shell is gone and a clean one is
  // shown, so the row never falls back to an empty pane.
  assertEquals(groupTabs(closed, "terminal").map((t) => t.title), ["Terminal"]);
  assertEquals(activeTabId(closed), groupTabs(closed, "terminal")[0].id);
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
  let v = addTab(createInitialView(), "gitdiff"); // right-2
  v = addTab(v, "terminal"); // right-3, shown
  v = closeTab(v, "right-3");
  assertEquals(activeTabId(v), "right-1"); // the other terminal, not the gitdiff tab
});

Deno.test("closeTab leaves the shown tab unchanged when closing a different one", () => {
  let v = addTab(createInitialView(), "terminal"); // right-2, shown
  v = closeTab(v, "right-1");
  assertEquals(activeTabId(v), "right-2");
});

Deno.test("closeTab leaves another group's memory and the selection alone", () => {
  let v = addTab(createInitialView(), "gitdiff"); // right-2, gitdiff selected
  v = closeTab(v, "right-1"); // the terminal row's last tab, refilled with a fresh one
  assertEquals(v.right.activeGroup, "gitdiff"); // refilling a row you aren't on can't pull you to it
  assertEquals(v.right.activeTabs.gitdiff, "right-2");
  assertEquals(v.right.activeTabs.terminal, groupTabs(v, "terminal")[0].id);
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

Deno.test("addEditorTab adds a terminal tab in the editor group, titled with the basename", () => {
  const v = createInitialView();
  const before = v.right.tabs.length;
  const next = addEditorTab(v, "/home/ivy/workspace/pique/src/lib/layout.ts");
  assertEquals(next.right.tabs.length, before + 1);
  const tab = next.right.tabs.at(-1)!;
  assertEquals(tab.kind, "terminal");
  assertEquals(tab.group, EDITOR);
  assertEquals(tab.title, "layout.ts");
  assertEquals(next.right.activeGroup, EDITOR);
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

Deno.test("editors stack up in the editor group beside the tree", () => {
  let v = addEditorTab(createInitialView(), "src/a.ts");
  v = addEditorTab(v, "src/b.ts");
  assertEquals(groupTabs(v, EDITOR).map((t) => t.title), ["a.ts", "b.ts"]);
  assertEquals(groupTabs(v, "terminal").length, 1); // the shell is untouched
});

Deno.test("addDiffTab adds a gitdiff tab in the editor group, scoped to the file path", () => {
  const v = createInitialView();
  const before = v.right.tabs.length;
  const next = addDiffTab(v, "/home/ivy/workspace/pique/src/lib/layout.ts");
  assertEquals(next.right.tabs.length, before + 1);
  const tab = next.right.tabs.at(-1)!;
  assertEquals(tab.kind, "gitdiff");
  assertEquals(tab.group, EDITOR);
  assertEquals(tab.title, "layout.ts");
  assertEquals(next.right.activeGroup, EDITOR);
  assertEquals(activeTabId(next), tab.id);
  assertEquals(tab.props, {
    path: "/home/ivy/workspace/pique/src/lib/layout.ts",
  });
});

Deno.test("library is a module kind with a capitalised label", () => {
  assertEquals(moduleLabel("library"), "Library");
});

Deno.test("addTab opens a Library tab titled Library", () => {
  const v = addTab(createInitialView(), "library");
  const tab = v.right.tabs.at(-1)!;
  assertEquals(tab.kind, "library");
  assertEquals(tab.title, "Library");
  assertEquals(activeTabId(v), tab.id);
});

// A view saved while a module was installed, read back after it was removed.
function savedView(right: ViewState["right"]): ViewState {
  return { ...createInitialView(), right };
}

// A removed module leaves views naming its row. Opening there would show "Unknown
// module" with nothing selected on the rail and — since a singleton row has no tab
// strip — no close button either, so the tab could not be dismissed.
Deno.test("adoptView falls back when the selected row is one the rail no longer offers", () => {
  const v = adoptView(savedView({
    activeGroup: "notes", // a module that has since been removed
    tabs: [
      { id: "right-1", title: "Terminal", kind: "terminal", group: "terminal" },
      { id: "right-2", title: "Notes", kind: "notes", group: "notes" },
    ],
    activeTabs: { terminal: "right-1", notes: "right-2" },
  }));
  assertEquals(v.right.activeGroup, "terminal");
  // The tab itself stays. Reinstalling the module brings the row back with the tab where
  // it was left, and while it is gone the tab is simply unreachable rather than stuck
  // on screen.
  assertEquals(v.right.tabs.map((t) => t.id), ["right-1", "right-2"]);
  assertEquals(isViewState(v), true);
});

// The fallback must not fire for a module that IS installed — which is why the module
// table is hydrated before the layout in main.ts.
Deno.test("adoptView keeps the selected row when it is an installed module", () => {
  setInstalledModules([{ kind: "notes", label: "Notes", key: "" }]);
  try {
    const v = adoptView(savedView({
      activeGroup: "notes",
      tabs: [{ id: "right-2", title: "Notes", kind: "notes", group: "notes" }],
      activeTabs: { notes: "right-2" },
    }));
    assertEquals(v.right.activeGroup, "notes");
  } finally {
    setInstalledModules([]);
  }
});

// Nothing open to fall back TO, so the default view's row is what is left.
Deno.test("adoptView falls back to the default row when no open tab sits on an offered one", () => {
  const v = adoptView(savedView({
    activeGroup: "notes",
    tabs: [{ id: "right-2", title: "Notes", kind: "notes", group: "notes" }],
    activeTabs: { notes: "right-2" },
  }));
  assertEquals(v.right.activeGroup, "terminal");
});
