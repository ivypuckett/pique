import { assertEquals } from "@std/assert";
import {
  addWorkspace,
  adoptSession,
  allWorkspaces,
  closeWorkspace,
  createInitialSession,
  focusAdjacent,
  focusWorkspace,
  isSessionState,
  updateWorkspace,
} from "./session.ts";
import { addView } from "./workspace.ts";

Deno.test("createInitialSession is one workspace, active", () => {
  const s = createInitialSession();
  assertEquals(s.workspaces.map((w) => [w.id, w.title]), [["ws-1", "Workspace 1"]]);
  assertEquals(s.activeId, "ws-1");
});

Deno.test("allWorkspaces lists the workspaces in rail order", () => {
  const s = addWorkspace(addWorkspace(createInitialSession()));
  assertEquals(allWorkspaces(s).map((w) => w.id), ["ws-1", "ws-2", "ws-3"]);
});

Deno.test("addWorkspace appends a titled workspace and activates it", () => {
  const s = addWorkspace(createInitialSession());
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2"]);
  assertEquals(s.workspaces[1].title, "Workspace 2");
  assertEquals(s.activeId, "ws-2");
});

Deno.test("addWorkspace seeds the new workspace's cwd when given one", () => {
  const s = addWorkspace(createInitialSession(), "/proj/x");
  assertEquals(s.workspaces[1].cwd, "/proj/x");
  // No cwd, or a blank one, leaves it unset.
  assertEquals(
    addWorkspace(createInitialSession()).workspaces[1].cwd,
    undefined,
  );
  assertEquals(
    addWorkspace(createInitialSession(), "  ").workspaces[1].cwd,
    undefined,
  );
});

Deno.test("closeWorkspace removes the active one and activates the previous neighbor", () => {
  let s = addWorkspace(addWorkspace(createInitialSession())); // ws-1..3, ws-3 active
  s = closeWorkspace(s);
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

Deno.test("closeWorkspace activates the next neighbor when the first is closed", () => {
  let s = addWorkspace(createInitialSession()); // ws-1, ws-2
  s = focusWorkspace(s, "ws-1");
  s = closeWorkspace(s);
  assertEquals(s.workspaces.map((w) => w.id), ["ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

// The way closing a workspace's last view leaves a fresh view-1.
Deno.test("closeWorkspace leaves a fresh ws-1 when the last workspace closes", () => {
  let s = addWorkspace(createInitialSession());
  s = closeWorkspace(focusWorkspace(s, "ws-1")); // ws-2 alone
  s = updateWorkspace(s, "ws-2", addView);
  s = closeWorkspace(s);
  assertEquals(s, createInitialSession());
});

Deno.test("focusAdjacent walks the workspaces, clamping at the ends", () => {
  let s = addWorkspace(createInitialSession()); // ws-1, ws-2 (ws-2 active)
  assertEquals(focusAdjacent(s, 1).activeId, "ws-2"); // already last, clamps
  s = focusAdjacent(s, -1);
  assertEquals(s.activeId, "ws-1");
  assertEquals(focusAdjacent(s, -1).activeId, "ws-1"); // already first, clamps
});

Deno.test("focusWorkspace is a no-op for an unknown id", () => {
  const s = focusWorkspace(createInitialSession(), "ws-999");
  assertEquals(s.activeId, "ws-1");
});

Deno.test("updateWorkspace edits one workspace, leaving others untouched", () => {
  const s = addWorkspace(createInitialSession()); // ws-1, ws-2
  const next = updateWorkspace(s, "ws-2", addView);
  assertEquals(next.workspaces[0].views.length, 1);
  assertEquals(next.workspaces[1].views.length, 2);
});

Deno.test("titles do not renumber: closing ws-2 of three and adding reads 1, 3, 2", () => {
  let s = addWorkspace(addWorkspace(createInitialSession())); // ws-1..3
  s = focusWorkspace(s, "ws-2");
  s = closeWorkspace(s); // ws-2 gone; ws-1, ws-3 remain
  s = addWorkspace(s); // smallest free is 2 again, appended at the end
  assertEquals(s.workspaces.map((w) => w.title), [
    "Workspace 1",
    "Workspace 3",
    "Workspace 2",
  ]);
});

Deno.test("isSessionState accepts a real session and rejects malformed shapes", () => {
  assertEquals(isSessionState(createInitialSession()), true);
  assertEquals(isSessionState(addWorkspace(createInitialSession())), true);
  assertEquals(
    isSessionState(JSON.parse(JSON.stringify(createInitialSession()))),
    true,
  );
  assertEquals(isSessionState(null), false);
  assertEquals(isSessionState({}), false);
  // No workspaces at all.
  assertEquals(isSessionState({ workspaces: [], activeId: "ws-1" }), false);
  // activeId names no workspace
  const s = createInitialSession();
  assertEquals(isSessionState({ ...s, activeId: "ws-999" }), false);
});

// A layout written while the root workspace existed still passes the guard when its
// active workspace is a numbered one; the root it carries is dropped, not kept.
Deno.test("adoptSession keeps only what a session has", () => {
  const s = createInitialSession();
  const old = { ...s, root: s.workspaces[0] } as typeof s;
  assertEquals(isSessionState(old), true);
  assertEquals(Object.keys(adoptSession(old)).sort(), ["activeId", "workspaces"]);
});
