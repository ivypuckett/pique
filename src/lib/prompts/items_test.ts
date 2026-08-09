import { assertEquals } from "@std/assert";
import { promptItems } from "./items.ts";
import type { PromptInfo } from "./bindings.ts";

function p(over: Partial<PromptInfo> = {}): PromptInfo {
  return {
    name: "standup",
    description: "",
    body: "hello",
    scope: "ws-2",
    state: "live",
    ...over,
  };
}

Deno.test("a pending template awaits review and a live one is active", () => {
  const items = promptItems(
    [
      p({ name: "a", state: "pending" }),
      p({ name: "b", state: "live" }),
    ],
    [],
    "ws-2",
  );
  assertEquals(items.map((i) => i.state), ["pending", "active"]);
});

// The `/` is how you invoke it, and it is how the `/` menu shows it, so the row says the
// same thing rather than making you remember the prefix.
Deno.test("the title carries the leading slash", () => {
  assertEquals(
    promptItems([p({ name: "standup" })], [], "ws-2")[0].title,
    "/standup",
  );
});

// Root's list arrives whole; only its live templates are invocable in a workspace, so a
// pending one in root must not appear as something this workspace inherits.
Deno.test("only root's live templates are inherited", () => {
  const items = promptItems([], [
    p({ name: "shared", scope: "root", state: "live" }),
    p({ name: "draft", scope: "root", state: "pending" }),
  ], "ws-2");
  assertEquals(items.map((i) => i.title), ["/shared"]);
  assertEquals(items[0].state, "inherited");
});

// pi resolves a name collision by load order (prompts/service.ts) and the local one
// wins, so root's row is listed but unreachable. Saying nothing would show two live
// rows for one working template.
Deno.test("a root template shadowed by a local one of the same name says so", () => {
  const items = promptItems(
    [p({ name: "standup", state: "live" })],
    [p({ name: "standup", scope: "root", state: "live" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, "shadowed");
});

Deno.test("an unshadowed inherited template has no badge", () => {
  const items = promptItems(
    [p({ name: "standup", state: "live" })],
    [p({ name: "other", scope: "root", state: "live" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, undefined);
});

// A local PENDING template does not shadow anything — it cannot be invoked at all yet.
Deno.test("a pending local template does not shadow root's live one", () => {
  const items = promptItems(
    [p({ name: "standup", state: "pending" })],
    [p({ name: "standup", scope: "root", state: "live" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, undefined);
});

// A template whose frontmatter would not parse is still listed, with its body, so you
// can see what is wrong instead of the file silently vanishing.
Deno.test("a parse error rides along as a problem", () => {
  const items = promptItems(
    [p({ error: "frontmatter: bad yaml" })],
    [],
    "ws-2",
  );
  assertEquals(items[0].problem, "frontmatter: bad yaml");
});
