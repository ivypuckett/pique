// Maps a scope's prompt templates into Library rows, and holds the editor's draft shape.
// Pure: Library.svelte owns the fetch.
import type { PromptInfo } from "./bindings.ts";
import type { LibraryItem, LibraryState } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";

// The create/edit form's state. It lives in the shell rather than in PromptEditor so a
// scope switch can discard it — a draft belongs to the scope it was started in, and
// saving it after a switch would write it into the wrong one.
export type Draft = {
  name: string;
  description: string;
  argumentHint: string;
  body: string;
  // Whether the name is still editable. Renaming an existing template would save under
  // the new name and leave the old file behind.
  creating: boolean;
};

function row(prompt: PromptInfo, state: LibraryState): LibraryItem {
  return {
    kind: "prompt",
    key: `prompt/${prompt.scope}/${prompt.name}`,
    scope: prompt.scope,
    state,
    title: `/${prompt.name}`,
    subtitle: prompt.description,
    problem: prompt.error,
    prompt,
  };
}

// `own` is the scope's own templates, both states — the ones it can edit and approve.
// `root` is root's full list, of which only the live ones are invocable here; ROOT
// itself must be passed an empty array, since it inherits from nothing and would
// otherwise list every one of its own templates twice.
//
// `_scope` is unused: a template's own `scope` field already says where it lives, and
// the caller decides what to pass as `root`. It stays in the signature so all three
// mappers are called the same way from the shell.
export function promptItems(
  own: PromptInfo[],
  root: PromptInfo[],
  _scope: ScopeId,
): LibraryItem[] {
  const liveLocally = new Set(
    own.filter((p) => p.state === "live").map((p) => p.name),
  );

  const items = own.map((p) =>
    row(p, p.state === "pending" ? "pending" : "active")
  );

  for (const p of root) {
    if (p.state !== "live") continue;
    const item = row(p, "inherited");
    // pi takes the nearest on a name collision (prompts/service.ts), so root's copy is
    // listed but unreachable. A pending local template shadows nothing — it cannot be
    // invoked at all yet.
    if (liveLocally.has(p.name)) item.badge = "shadowed";
    items.push(item);
  }
  return items;
}
