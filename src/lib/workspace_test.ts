import { assertEquals } from "@std/assert";
import {
  addView,
  closeView,
  createInitialWorkspace,
  focusAdjacent,
  focusView,
  isWorkspaceState,
  setWorkspaceDir,
  updateView,
} from "./workspace.ts";
import { toggleCollapse } from "./layout.ts";

Deno.test("createInitialWorkspace has one view, active", () => {
  const w = createInitialWorkspace();
  assertEquals(w.views.length, 1);
  assertEquals(w.views[0].id, "view-1");
  assertEquals(w.activeId, "view-1");
});

Deno.test("addView appends a fresh view and activates it", () => {
  const w = addView(createInitialWorkspace());
  assertEquals(w.views.map((v) => v.id), ["view-1", "view-2"]);
  assertEquals(w.activeId, "view-2");
});

Deno.test("addView picks the smallest free view-N id", () => {
  let w = addView(createInitialWorkspace()); // view-2
  w = addView(w); // view-3
  assertEquals(w.views.map((v) => v.id), ["view-1", "view-2", "view-3"]);
});

Deno.test("closeView removes the active view and activates the previous neighbor", () => {
  let w = addView(createInitialWorkspace()); // view-2 active
  w = addView(w); // view-3 active
  w = closeView(w);
  assertEquals(w.views.map((v) => v.id), ["view-1", "view-2"]);
  assertEquals(w.activeId, "view-2");
});

Deno.test("closeView activates the next neighbor when the first view is closed", () => {
  let w = addView(createInitialWorkspace()); // view-2
  w = focusView(w, "view-1");
  w = closeView(w);
  assertEquals(w.views.map((v) => v.id), ["view-2"]);
  assertEquals(w.activeId, "view-2");
});

Deno.test("closeView resets to a fresh view-1 when closing the last view", () => {
  let w = addView(createInitialWorkspace()); // view-1, view-2 (view-2 active)
  w = focusView(w, "view-1");
  w = closeView(w); // -> ["view-2"]
  w = closeView(w); // last view -> fresh view-1
  assertEquals(w.views.map((v) => v.id), ["view-1"]);
  assertEquals(w.activeId, "view-1");
});

Deno.test("focusAdjacent moves the active id and clamps at the ends", () => {
  let w = addView(createInitialWorkspace()); // view-2
  w = addView(w); // view-3, active
  assertEquals(focusAdjacent(w, 1).activeId, "view-3"); // already last, clamps
  w = focusAdjacent(w, -1);
  assertEquals(w.activeId, "view-2");
  w = focusAdjacent(w, -1);
  assertEquals(w.activeId, "view-1");
  assertEquals(focusAdjacent(w, -1).activeId, "view-1"); // already first, clamps
});

Deno.test("focusView is a no-op for an unknown view id", () => {
  const w = focusView(createInitialWorkspace(), "view-999");
  assertEquals(w.activeId, "view-1");
});

Deno.test("updateView edits one view by id, leaving others untouched", () => {
  const w = addView(createInitialWorkspace()); // view-1, view-2
  const next = updateView(w, "view-2", (v) => toggleCollapse(v, "left"));
  assertEquals(next.views[0].left.collapsed, false);
  assertEquals(next.views[1].left.collapsed, true);
});

Deno.test("createInitialWorkspace defaults to ws-1 / Workspace 1", () => {
  const w = createInitialWorkspace();
  assertEquals(w.id, "ws-1");
  assertEquals(w.title, "Workspace 1");
});

Deno.test("createInitialWorkspace takes an explicit id and title", () => {
  const w = createInitialWorkspace("ws-7", "Workspace 7");
  assertEquals(w.id, "ws-7");
  assertEquals(w.title, "Workspace 7");
  assertEquals(w.views.length, 1);
  assertEquals(w.activeId, "view-1");
});

Deno.test("setWorkspaceDir sets the override and clears it on blank input", () => {
  const w = createInitialWorkspace();
  assertEquals(w.cwd, undefined);
  assertEquals(setWorkspaceDir(w, "/proj/x").cwd, "/proj/x");
  // Blank/whitespace clears back to "use the default".
  assertEquals(setWorkspaceDir(setWorkspaceDir(w, "/proj/x"), "").cwd, undefined);
  assertEquals(setWorkspaceDir(setWorkspaceDir(w, "/proj/x"), "   ").cwd, undefined);
});

Deno.test("isWorkspaceState accepts an optional string cwd and rejects a non-string", () => {
  const w = createInitialWorkspace();
  assertEquals(isWorkspaceState({ ...w, cwd: "/proj/x" }), true);
  assertEquals(isWorkspaceState({ ...w, cwd: undefined }), true);
  assertEquals(isWorkspaceState({ ...w, cwd: 42 }), false);
});

Deno.test("isWorkspaceState rejects a workspace missing id or title", () => {
  const w = createInitialWorkspace();
  const { id: _id, ...noId } = w;
  const { title: _title, ...noTitle } = w;
  assertEquals(isWorkspaceState(noId), false);
  assertEquals(isWorkspaceState(noTitle), false);
});

Deno.test("isWorkspaceState accepts a real workspace and rejects malformed shapes", () => {
  assertEquals(isWorkspaceState(createInitialWorkspace()), true);
  assertEquals(isWorkspaceState(addView(createInitialWorkspace())), true);
  assertEquals(
    isWorkspaceState(JSON.parse(JSON.stringify(createInitialWorkspace()))),
    true,
  );
  assertEquals(isWorkspaceState(null), false);
  assertEquals(isWorkspaceState({}), false);
  assertEquals(isWorkspaceState({ views: [], activeId: "view-1" }), false);
  // activeId names no view
  const w = createInitialWorkspace();
  assertEquals(isWorkspaceState({ ...w, activeId: "view-999" }), false);
});
