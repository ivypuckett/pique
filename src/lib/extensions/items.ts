// Maps a scope's visible extensions into Library rows. Pure: the fetch belongs to
// Library.svelte, which does all five of the module's reads in one go so a scope switch
// can discard them together.
import type { Extension } from "./bindings.ts";
import type { LibraryItem, LibraryState } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";

function stateOf(e: Extension, scope: ScopeId): LibraryState {
  // Enabled and revoked where it lives, so a workspace can only look at root's.
  if (e.scope !== scope) return "inherited";
  return e.state === "pending" ? "pending" : "active";
}

// `visible` is everything reachable from `scope` — its own plus what it inherits.
export function extensionItems(
  visible: Extension[],
  scope: ScopeId,
): LibraryItem[] {
  return visible.map((ext) => ({
    kind: "extension" as const,
    key: `extension/${ext.scope}/${ext.id}`,
    scope: ext.scope,
    state: stateOf(ext, scope),
    title: ext.name,
    // What the row is really identified by: a package's source string, or a local
    // module's path.
    subtitle: ext.source ?? ext.path,
    badge: ext.origin,
    ext,
  }));
}
