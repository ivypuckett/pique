import { assertEquals } from "@std/assert";
import { skillItems } from "./items.ts";
import type { SkillInfo } from "./bindings.ts";

function s(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "brainstorming",
    description: "explore an idea",
    path: "/home/x/.pique/scopes/ws-2/agent/skills/brainstorming",
    scope: "ws-2",
    ...over,
  };
}

// A skill has no review gate — it is markdown a model reads, not code that executes — so
// the only question is whose it is.
Deno.test("a skill in this scope is active and one from an ancestor is inherited", () => {
  assertEquals(skillItems([s()], "ws-2")[0].state, "active");
  assertEquals(
    skillItems([s({ scope: "root" })], "ws-2")[0].state,
    "inherited",
  );
});

Deno.test("no skill is ever pending", () => {
  const items = skillItems([s(), s({ name: "other", scope: "root" })], "ws-2");
  assertEquals(items.filter((i) => i.state === "pending"), []);
});

// An automaton names a skill by its path basename, never by the frontmatter `name:`
// (skills/service.ts). Surfacing the divergence here beats a mysterious "skill not
// found" at launch time.
Deno.test("a frontmatter name that disagrees with the basename becomes a note", () => {
  const items = skillItems(
    [s({ name: "brainstorm", frontmatterName: "brainstorming" })],
    "ws-2",
  );
  assertEquals(
    items[0].note,
    "Its frontmatter says brainstorming; name it brainstorm.",
  );
});

Deno.test("a frontmatter name that agrees leaves no note", () => {
  const items = skillItems([s({ frontmatterName: "brainstorming" })], "ws-2");
  assertEquals(items[0].note, undefined);
});

// Malformed frontmatter is a problem (red), a naming quirk is a note (dim). A file that
// will not parse has no usable frontmatterName to disagree about anyway.
Deno.test("malformed frontmatter is a problem, not a note", () => {
  const items = skillItems([s({ error: "frontmatter: bad yaml" })], "ws-2");
  assertEquals(items[0].problem, "frontmatter: bad yaml");
  assertEquals(items[0].note, undefined);
});

// listVisibleSkills de-duplicates by name across the chain, but two scopes can still
// hold different skills, so the path is what makes a key unique.
Deno.test("the key is namespaced by the skill's path", () => {
  const items = skillItems([s({ path: "/a/b/c", scope: "root" })], "ws-2");
  assertEquals(items[0].key, "skill/root//a/b/c");
});
