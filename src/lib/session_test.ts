import { assertEquals } from "@std/assert";
import {
  addWorkspace,
  allWorkspaces,
  closeWorkspace,
  createInitialSession,
  focusAdjacent,
  focusWorkspace,
  isSessionState,
  migrateSession,
  updateWorkspace,
} from "./session.ts";
import { addView } from "./workspace.ts";

Deno.test("createInitialSession is the root workspace alone, active", () => {
  const s = createInitialSession();
  assertEquals(s.root.id, "root");
  assertEquals(s.root.title, "Root");
  assertEquals(s.workspaces, []);
  assertEquals(s.activeId, "root");
});

Deno.test("allWorkspaces lists root first, then the numbered ones", () => {
  const s = addWorkspace(addWorkspace(createInitialSession()));
  assertEquals(allWorkspaces(s).map((w) => w.id), ["root", "ws-1", "ws-2"]);
});

Deno.test("addWorkspace appends a titled workspace and activates it", () => {
  const s = addWorkspace(createInitialSession());
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1"]);
  assertEquals(s.workspaces[0].title, "Workspace 1");
  assertEquals(s.activeId, "ws-1");
});

Deno.test("addWorkspace seeds the new workspace's cwd when given one", () => {
  const s = addWorkspace(createInitialSession(), "/proj/x");
  assertEquals(s.workspaces[0].cwd, "/proj/x");
  // No cwd, or a blank one, leaves the override unset.
  assertEquals(
    addWorkspace(createInitialSession()).workspaces[0].cwd,
    undefined,
  );
  assertEquals(
    addWorkspace(createInitialSession(), "  ").workspaces[0].cwd,
    undefined,
  );
});

Deno.test("addWorkspace picks the smallest free ws-N id", () => {
  let s = addWorkspace(createInitialSession()); // ws-1
  s = addWorkspace(s); // ws-2
  s = addWorkspace(s); // ws-3
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2", "ws-3"]);
  assertEquals(s.workspaces.map((w) => w.title), [
    "Workspace 1",
    "Workspace 2",
    "Workspace 3",
  ]);
});

Deno.test("closeWorkspace removes the active one and activates the previous neighbor", () => {
  let s = addWorkspace(addWorkspace(addWorkspace(createInitialSession()))); // ws-1..3
  s = closeWorkspace(s); // ws-3 was active
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

Deno.test("closeWorkspace activates the next neighbor when the first is closed", () => {
  let s = addWorkspace(addWorkspace(createInitialSession())); // ws-1, ws-2
  s = focusWorkspace(s, "ws-1");
  s = closeWorkspace(s);
  assertEquals(s.workspaces.map((w) => w.id), ["ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

Deno.test("closeWorkspace falls back to root when the last numbered workspace closes", () => {
  let s = addWorkspace(createInitialSession()); // ws-1, active
  s = closeWorkspace(s);
  assertEquals(s.workspaces, []);
  assertEquals(s.activeId, "root");
  assertEquals(s.root.id, "root");
});

Deno.test("closeWorkspace cannot close root", () => {
  const s = addWorkspace(createInitialSession()); // ws-1
  const atRoot = focusWorkspace(s, "root");
  assertEquals(closeWorkspace(atRoot), atRoot);
});

Deno.test("focusAdjacent walks root and the numbered workspaces, clamping at the ends", () => {
  let s = addWorkspace(addWorkspace(createInitialSession())); // ws-1, ws-2 (ws-2 active)
  assertEquals(focusAdjacent(s, 1).activeId, "ws-2"); // already last, clamps
  s = focusAdjacent(s, -1);
  assertEquals(s.activeId, "ws-1");
  s = focusAdjacent(s, -1);
  assertEquals(s.activeId, "root"); // root sits above the numbered ones
  assertEquals(focusAdjacent(s, -1).activeId, "root"); // already first, clamps
});

Deno.test("focusWorkspace is a no-op for an unknown id", () => {
  const s = focusWorkspace(addWorkspace(createInitialSession()), "ws-999");
  assertEquals(s.activeId, "ws-1");
});

Deno.test("updateWorkspace edits one workspace, leaving others untouched", () => {
  const s = addWorkspace(addWorkspace(createInitialSession())); // ws-1, ws-2
  const next = updateWorkspace(s, "ws-2", addView);
  assertEquals(next.workspaces[0].views.length, 1);
  assertEquals(next.workspaces[1].views.length, 2);
  assertEquals(next.root.views.length, 1);
});

Deno.test("updateWorkspace addresses root by id", () => {
  const s = updateWorkspace(createInitialSession(), "root", addView);
  assertEquals(s.root.views.length, 2);
});

Deno.test("titles do not renumber: closing ws-2 of three and adding reads 1, 3, 2", () => {
  let s = addWorkspace(addWorkspace(addWorkspace(createInitialSession()))); // ws-1..3
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
  // Pre-root shape: no root workspace.
  assertEquals(isSessionState({ workspaces: [], activeId: "ws-1" }), false);
  // activeId names no workspace
  const s = createInitialSession();
  assertEquals(isSessionState({ ...s, activeId: "ws-999" }), false);
});

Deno.test("migrateSession adopts a pre-root layout under a fresh root", () => {
  const old = {
    workspaces: addWorkspace(createInitialSession()).workspaces,
    activeId: "ws-1",
  };
  const s = migrateSession(old, "~/workspace")!;
  assertEquals(s.root.id, "root");
  assertEquals(s.root.cwd, "~/workspace"); // the old global defaultDir becomes root's
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1"]);
  assertEquals(s.activeId, "ws-1");
  assertEquals(isSessionState(s), true);
});

Deno.test("migrateSession passes a current session through and rejects junk", () => {
  const s = createInitialSession();
  assertEquals(migrateSession(s), s);
  assertEquals(migrateSession(null), null);
  assertEquals(migrateSession({ nope: 1 }), null);
});
