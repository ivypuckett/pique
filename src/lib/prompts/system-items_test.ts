import { assertEquals } from "@std/assert";
import { promptFileItems } from "./system-items.ts";
import type { PromptFileInfo } from "./system-bindings.ts";

function file(
  kind: "system" | "appendix",
  body?: string,
): PromptFileInfo {
  return { kind, path: `/home/x/.pi/agent/${kind}`, body };
}

Deno.test("both rows are listed, present or not", () => {
  const items = promptFileItems([file("system"), file("appendix", "rules")]);
  assertEquals(items.map((i) => [i.title, i.subtitle]), [
    ["SYSTEM.md", "not set"],
    ["APPEND_SYSTEM.md", "rules"],
  ]);
});

Deno.test("a set file previews its first non-blank line", () => {
  const [item] = promptFileItems([file("system", "\n\n  You are terse.\nMore.")]);
  assertEquals(item.subtitle, "You are terse.");
});

Deno.test("keys are unique across the two kinds", () => {
  const keys = promptFileItems([file("system"), file("appendix")]).map((i) =>
    i.key
  );
  assertEquals(new Set(keys).size, 2);
});
