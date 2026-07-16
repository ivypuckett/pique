import { assertEquals } from "@std/assert";
import { addWorkspace, createInitialSession } from "./session.ts";

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
