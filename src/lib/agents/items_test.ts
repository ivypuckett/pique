import { assertEquals } from "@std/assert";
import { agentItems } from "./items.ts";
import type { AgentDef } from "./bindings.ts";

function a(over: Partial<AgentDef> = {}): AgentDef {
  return { name: "scout", description: "", systemPrompt: "Be fast.", ...over };
}

Deno.test("a scope's own definitions are active, and keyed to that scope", () => {
  const items = agentItems([a({ name: "scout" })], [], "ws-2");
  assertEquals(items.length, 1);
  assertEquals(items[0].state, "active");
  assertEquals(items[0].key, "subagent/ws-2/scout");
  assertEquals(items[0].scope, "ws-2");
});

// The description is what the calling agent reads when it picks one, so it is what the
// row shows beside the name.
Deno.test("the row shows the name and its description", () => {
  const items = agentItems(
    [a({ name: "scout", description: "recon" })],
    [],
    "ws-2",
  );
  assertEquals(items[0].title, "scout");
  assertEquals(items[0].subtitle, "recon");
});

Deno.test("root's definitions are inherited, and keyed to root", () => {
  const items = agentItems([], [a({ name: "planner" })], "ws-2");
  assertEquals(items[0].state, "inherited");
  assertEquals(items[0].key, "subagent/root/planner");
  assertEquals(items[0].scope, "root");
});

// listVisibleAgents resolves a collision to the nearest scope (agents/service.ts), so
// root's copy is listed but never the one that runs. Saying nothing would show two rows
// for one working subagent.
Deno.test("a root definition shadowed by a local one of the same name says so", () => {
  const items = agentItems(
    [a({ name: "scout" })],
    [a({ name: "scout" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, "shadowed");
});

Deno.test("an unshadowed inherited definition has no badge", () => {
  const items = agentItems(
    [a({ name: "scout" })],
    [a({ name: "planner" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, undefined);
});

// A definition whose frontmatter would not parse is still listed, with its body, so you
// can open it and fix it instead of the file silently vanishing.
Deno.test("a parse error rides along as a problem", () => {
  const items = agentItems([a({ error: "frontmatter: bad yaml" })], [], "ws-2");
  assertEquals(items[0].problem, "frontmatter: bad yaml");
});

// Root viewing its own list passes [] as `root` — it inherits from nothing, and passing
// its own list would show every definition twice.
Deno.test("root's own list is active, not inherited", () => {
  const items = agentItems([a({ name: "scout" })], [], "root");
  assertEquals(items[0].state, "active");
  assertEquals(items[0].key, "subagent/root/scout");
});
