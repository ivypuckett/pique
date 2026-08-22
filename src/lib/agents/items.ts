// Maps a scope's subagent definitions into Library rows, and holds the editor's draft
// shape. Pure: Library.svelte owns the fetch.
import type { AgentDef } from "./bindings.ts";
import type { LibraryItem, LibraryState } from "../library/items.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// The create/edit form's state. It lives in the shell rather than in AgentEditor so a
// scope switch can discard it — a draft belongs to the scope it was started in.
//
// `tools` is the raw comma-separated string the field holds, not the parsed array: it is
// what the user is mid-way through typing, and splitting it on every keystroke would
// swallow the comma they just pressed. The shell splits it once, on save.
export type Draft = {
  name: string;
  description: string;
  tools: string;
  model: string;
  systemPrompt: string;
  // Whether the name is still editable. Renaming an existing definition would save under
  // the new name and leave the old file behind.
  creating: boolean;
};

function row(def: AgentDef, scope: ScopeId, state: LibraryState): LibraryItem {
  return {
    kind: "subagent",
    key: `subagent/${scope}/${def.name}`,
    scope,
    state,
    title: def.name,
    subtitle: def.description,
    problem: def.error,
    agent: def,
  };
}

// `own` is the scope's own definitions — the ones it can edit and delete. `root` is
// root's, invocable here but managed there; ROOT itself must be passed an empty array,
// since it inherits from nothing and would otherwise list every definition twice.
//
// There is no pending state to sort out: a subagent definition is written straight to
// live by both halves (agents/paths.ts records why there is no quarantine).
export function agentItems(
  own: AgentDef[],
  root: AgentDef[],
  scope: ScopeId,
): LibraryItem[] {
  const names = new Set(own.map((d) => d.name));
  const items = own.map((d) => row(d, scope, "active"));

  for (const d of root) {
    const item = row(d, ROOT, "inherited");
    // listVisibleAgents takes the nearest on a name collision (agents/service.ts), so
    // root's copy is listed but can never be the one that runs.
    if (names.has(d.name)) item.badge = "shadowed";
    items.push(item);
  }
  return items;
}
