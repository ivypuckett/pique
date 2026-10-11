import { assertEquals } from "@std/assert";
import { type LibraryItem, sortItems } from "./items.ts";

// Minimal fixtures. The per-kind payloads are only carried, never read, by this module,
// so they hold just enough to satisfy the types.
function ext(title: string): LibraryItem {
  return {
    kind: "extension",
    key: `extension/${title}`,
    title,
    ext: { id: title, name: title, origin: "local" },
  };
}

function prompt(title: string): LibraryItem {
  return {
    kind: "prompt",
    key: `prompt/${title}`,
    title,
    prompt: { name: title, description: "", body: "" },
  };
}

function skill(title: string): LibraryItem {
  return {
    kind: "skill",
    key: `skill/${title}`,
    title,
    skill: { name: title, description: "", path: `/tmp/${title}` },
  };
}

function promptFile(kind: "system" | "appendix", title: string): LibraryItem {
  return {
    kind,
    key: `${kind}/${title}`,
    title,
    file: { kind, path: `/tmp/${title}` },
  };
}

const titles = (items: LibraryItem[]): string[] => items.map((i) => i.title);

// Kind-first ordering keeps a row's neighbours stable as items come and go, which a pure
// alphabetical sort would not. The two prompt files lead: they steer everything below
// them, and they are the only rows that are always present, so they must not drift down
// a long extension list.
Deno.test("the prompt files lead, then extensions, prompts, skills", () => {
  const sorted = sortItems([
    skill("bbb"),
    prompt("ccc"),
    ext("ddd"),
    promptFile("appendix", "eee"),
    promptFile("system", "fff"),
  ]);
  assertEquals(titles(sorted), ["fff", "eee", "ddd", "ccc", "bbb"]);
});

Deno.test("ties within a kind break by title", () => {
  assertEquals(
    titles(sortItems([ext("zebra"), ext("apple"), ext("mango")])),
    ["apple", "mango", "zebra"],
  );
});

Deno.test("sorting leaves its input alone", () => {
  const items = [ext("b"), ext("a")];
  sortItems(items);
  assertEquals(titles(items), ["b", "a"]);
});
