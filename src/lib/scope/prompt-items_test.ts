import { assertEquals } from "@std/assert";
import { promptFileItems } from "./prompt-items.ts";
import type { PromptFileInfo, PromptFileKind } from "./prompt-bindings.ts";
import { ROOT, type ScopeId } from "./paths.ts";

function file(
  scope: ScopeId,
  kind: PromptFileKind,
  body?: string,
): PromptFileInfo {
  return { scope, kind, path: `/tmp/${scope}/${kind}`, body };
}

// listPromptFiles always returns both, in this order.
function pair(
  scope: ScopeId,
  system?: string,
  appendix?: string,
): PromptFileInfo[] {
  return [file(scope, "system", system), file(scope, "appendix", appendix)];
}

const shape = (
  items: ReturnType<typeof promptFileItems>,
) => items.map((i) => [i.kind, i.scope, i.state, i.subtitle, i.badge]);

// Both rows exist whether or not the files do — the decision that makes the Library the
// place you discover these two files rather than somewhere you manage ones you already
// knew about.
Deno.test("a scope's own rows are listed present or not", () => {
  assertEquals(shape(promptFileItems(pair("ws-1"), [], "ws-1")), [
    ["system", "ws-1", "active", "not set", undefined],
    ["appendix", "ws-1", "active", "not set", undefined],
  ]);
});

Deno.test("a set file previews its first non-blank line", () => {
  const items = promptFileItems(
    pair("ws-1", "\n\n  You are terse.  \nand more", "house rules"),
    [],
    "ws-1",
  );
  assertEquals(items[0].subtitle, "You are terse.");
  assertEquals(items[1].subtitle, "house rules");
});

// Root's rows appear only when the files exist: an inherited "not set" row is a row
// about a file you cannot edit here that also is not there.
Deno.test("root contributes rows only for files that exist", () => {
  assertEquals(
    shape(promptFileItems(pair("ws-1"), pair(ROOT, undefined, "house"), "ws-1")),
    [
      ["system", "ws-1", "active", "not set", undefined],
      ["appendix", "ws-1", "active", "not set", undefined],
      ["appendix", "root", "inherited", "house", "applied first"],
    ],
  );
});

// The badges are where the two merge rules diverge, and the only place a row says what
// happens when BOTH scopes have the file.
Deno.test("a workspace SYSTEM.md shadows root's; an appendix does not", () => {
  const items = promptFileItems(
    pair("ws-1", "workspace base", "swift archetype"),
    pair(ROOT, "root base", "house rules"),
    "ws-1",
  );
  assertEquals(shape(items), [
    ["system", "ws-1", "active", "workspace base", undefined],
    ["appendix", "ws-1", "active", "swift archetype", "applied after root's"],
    ["system", "root", "inherited", "root base", "shadowed"],
    ["appendix", "root", "inherited", "house rules", "applied first"],
  ]);
});

// Without a workspace file of its own, root's SYSTEM.md is what actually runs — so it
// must NOT be marked shadowed.
Deno.test("root's SYSTEM.md is unmarked when the workspace has none", () => {
  const items = promptFileItems(
    pair("ws-1", undefined, "swift archetype"),
    pair(ROOT, "root base"),
    "ws-1",
  );
  assertEquals(items[2].badge, undefined);
  // And the workspace appendix is the only one, so there is nothing for it to follow.
  assertEquals(items[1].badge, undefined);
});

Deno.test("keys are unique across kind and scope", () => {
  const items = promptFileItems(
    pair("ws-1", "a", "b"),
    pair(ROOT, "c", "d"),
    "ws-1",
  );
  const keys = items.map((i) => i.key);
  assertEquals(new Set(keys).size, keys.length);
  assertEquals(keys[0], "system/ws-1/SYSTEM.md");
  assertEquals(keys[3], "appendix/root/APPEND_SYSTEM.md");
});

// ROOT is passed an empty inherited list by the shell, since it inherits from nothing;
// asking twice would list its own two files as inherited from itself.
Deno.test("root viewing itself lists exactly two rows", () => {
  const items = promptFileItems(pair(ROOT, "root base", "house"), [], ROOT);
  assertEquals(items.length, 2);
  assertEquals(items.every((i) => i.state === "active"), true);
});
