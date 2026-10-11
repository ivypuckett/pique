import { assertEquals } from "@std/assert";
import { skillItems } from "./items.ts";
import type { SkillInfo } from "./bindings.ts";

function s(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "brainstorming",
    description: "explore an idea",
    path: "/home/x/.pique/agent/skills/brainstorming",
    ...over,
  };
}

// pique names a skill by its path basename, never by the frontmatter `name:`
// (skills/service.ts), so the divergence is surfaced.
Deno.test("a frontmatter name that disagrees with the basename becomes a note", () => {
  const items = skillItems(
    [s({ name: "brainstorm", frontmatterName: "brainstorming" })],
  );
  assertEquals(
    items[0].note,
    "Its frontmatter says brainstorming; name it brainstorm.",
  );
});

Deno.test("a frontmatter name that agrees leaves no note", () => {
  const items = skillItems([s({ frontmatterName: "brainstorming" })]);
  assertEquals(items[0].note, undefined);
});

// Malformed frontmatter is a problem (red), a naming quirk is a note (dim). A file that
// will not parse has no usable frontmatterName to disagree about anyway.
Deno.test("malformed frontmatter is a problem, not a note", () => {
  const items = skillItems([s({ error: "frontmatter: bad yaml" })]);
  assertEquals(items[0].problem, "frontmatter: bad yaml");
  assertEquals(items[0].note, undefined);
});

Deno.test("the key is namespaced by the skill's path", () => {
  const items = skillItems([s({ path: "/a/b/c" })]);
  assertEquals(items[0].key, "skill//a/b/c");
});
