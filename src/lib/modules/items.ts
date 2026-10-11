// Maps a scope's modules into Library rows. Pure: the fetch belongs to Library.svelte,
// which does all of the module's reads in one go so a scope switch can discard them
// together. Mirrors extensions/items.ts, which is the shape this follows.
import type { LibraryItem, LibraryState } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";
import type { InstalledModule } from "./bindings.ts";

// A module owned by an ancestor scope is `inherited` and read-only here, because it is
// managed where it lives — the same rule every other Library row follows.
function stateOf(scope: ScopeId, owner: ScopeId): LibraryState {
  return owner === scope ? "active" : "inherited";
}

export function moduleItems(
  installed: InstalledModule[],
  scope: ScopeId,
): LibraryItem[] {
  return installed.map((m) => ({
    kind: "module" as const,
    key: `module/${m.scope}/${m.kind}`,
    scope: m.scope,
    state: stateOf(scope, m.scope),
    title: m.label,
    subtitle: m.kind,
    badge: "module",
    module: m,
  }));
}
