import { assertEquals } from "@std/assert";
import {
  addWorkspace,
  closeWorkspace,
  createInitialSession,
  focusAdjacent,
  focusWorkspace,
  isSessionState,
  updateWorkspace,
} from "./session.ts";
import { addView } from "./workspace.ts";

Deno.test("createInitialSession has one workspace, active", () => {
  const s = createInitialSession();
  assertEquals(s.workspaces.length, 1);
  assertEquals(s.workspaces[0].id, "ws-1");
  assertEquals(s.workspaces[0].title, "Workspace 1");
  assertEquals(s.activeId, "ws-1");
});

Deno.test("addWorkspace appends a titled workspace and activates it", () => {
  const s = addWorkspace(createInitialSession());
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2"]);
  assertEquals(s.workspaces[1].title, "Workspace 2");
  assertEquals(s.activeId, "ws-2");
});

Deno.test("addWorkspace picks the smallest free ws-N id", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2", "ws-3"]);
  assertEquals(s.workspaces.map((w) => w.title), [
    "Workspace 1",
    "Workspace 2",
    "Workspace 3",
  ]);
});

Deno.test("closeWorkspace removes the active one and activates the previous neighbor", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3, active
  s = closeWorkspace(s);
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

Deno.test("closeWorkspace activates the next neighbor when the first is closed", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = focusWorkspace(s, "ws-1");
  s = closeWorkspace(s);
  assertEquals(s.workspaces.map((w) => w.id), ["ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

Deno.test("closeWorkspace is a no-op with a single workspace", () => {
  const s = closeWorkspace(createInitialSession());
  assertEquals(s.workspaces.length, 1);
  assertEquals(s.activeId, "ws-1");
});

Deno.test("focusAdjacent moves the active id and clamps at the ends", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3, active
  assertEquals(focusAdjacent(s, 1).activeId, "ws-3"); // already last, clamps
  s = focusAdjacent(s, -1);
  assertEquals(s.activeId, "ws-2");
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
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3
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
  assertEquals(isSessionState({ workspaces: [], activeId: "ws-1" }), false);
  // activeId names no workspace
  const s = createInitialSession();
  assertEquals(isSessionState({ ...s, activeId: "ws-999" }), false);
});
