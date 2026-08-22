import { assertEquals } from "@std/assert";
import { groupItems, type LibraryItem, type LibraryState } from "./items.ts";

// Minimal fixtures. The per-kind payloads are only carried, never read, by this module,
// so they hold just enough to satisfy the types.
function ext(title: string, state: LibraryState): LibraryItem {
  return {
    kind: "extension",
    key: `extension/root/${title}`,
    scope: "root",
    state,
    title,
    ext: {
      id: title,
      name: title,
      origin: "local",
      state: state === "pending" ? "pending" : "enabled",
      scope: "root",
    },
  };
}

function prompt(title: string, state: LibraryState): LibraryItem {
  return {
    kind: "prompt",
    key: `prompt/root/${title}`,
    scope: "root",
    state,
    title,
    prompt: {
      name: title,
      description: "",
      body: "",
      scope: "root",
      state: state === "pending" ? "pending" : "live",
    },
  };
}

function skill(title: string, state: LibraryState): LibraryItem {
  return {
    kind: "skill",
    key: `skill/root/${title}`,
    scope: "root",
    state,
    title,
    skill: {
      name: title,
      description: "",
      path: `/tmp/${title}`,
      scope: "root",
    },
  };
}

function subagent(title: string, state: LibraryState): LibraryItem {
  return {
    kind: "subagent",
    key: `subagent/root/${title}`,
    scope: "root",
    state,
    title,
    agent: { name: title, description: "", systemPrompt: "" },
  };
}

const titles = (items: LibraryItem[]): string[] => items.map((i) => i.title);

// The whole point of unifying: a pending prompt and a pending extension are one queue,
// not two lists you have to switch tabs between to see.
Deno.test("groups by state, mixing kinds within a group", () => {
  const groups = groupItems([
    skill("alpha", "active"),
    prompt("beta", "pending"),
    ext("gamma", "pending"),
    ext("delta", "inherited"),
  ]);
  assertEquals(titles(groups.pending), ["gamma", "beta"]);
  assertEquals(titles(groups.active), ["alpha"]);
  assertEquals(titles(groups.inherited), ["delta"]);
});

// Kind-first ordering keeps a row's neighbours stable as items come and go, which a
// pure alphabetical sort would not.
Deno.test("within a group, extensions come before prompts before skills before subagents", () => {
  const groups = groupItems([
    subagent("aaa", "active"),
    skill("bbb", "active"),
    prompt("ccc", "active"),
    ext("ddd", "active"),
  ]);
  assertEquals(titles(groups.active), ["ddd", "ccc", "bbb", "aaa"]);
});

Deno.test("ties within a kind break by title", () => {
  const groups = groupItems([
    ext("zebra", "active"),
    ext("apple", "active"),
    ext("mango", "active"),
  ]);
  assertEquals(titles(groups.active), ["apple", "mango", "zebra"]);
});

Deno.test("an empty library yields three empty groups", () => {
  const groups = groupItems([]);
  assertEquals(groups.pending, []);
  assertEquals(groups.active, []);
  assertEquals(groups.inherited, []);
});

// groupItems must not reorder its input in place: Library.svelte holds `items` in
// $state and derives the groups from it, so a mutating sort would shuffle the source
// of truth on every render.
Deno.test("grouping does not mutate the input array", () => {
  const input = [ext("zebra", "active"), ext("apple", "active")];
  groupItems(input);
  assertEquals(titles(input), ["zebra", "apple"]);
});
