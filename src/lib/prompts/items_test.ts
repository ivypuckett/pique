import { assertEquals } from "@std/assert";
import { promptItems } from "./items.ts";
import type { PromptInfo } from "./bindings.ts";

function p(over: Partial<PromptInfo> = {}): PromptInfo {
  return { name: "standup", description: "", body: "hello", ...over };
}

// The `/` is how you invoke it, and it is how the `/` menu shows it, so the row says the
// same thing rather than making you remember the prefix.
Deno.test("the title carries the leading slash", () => {
  assertEquals(promptItems([p({ name: "standup" })])[0].title, "/standup");
});

// A template whose frontmatter would not parse is still listed, with its body, so you
// can see what is wrong instead of the file silently vanishing.
Deno.test("a parse error rides along as a problem", () => {
  const items = promptItems([p({ error: "frontmatter: bad yaml" })]);
  assertEquals(items[0].problem, "frontmatter: bad yaml");
});
