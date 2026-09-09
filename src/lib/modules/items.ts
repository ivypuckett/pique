// Maps a scope's modules into Library rows. Pure: the fetch belongs to Library.svelte,
// which does all of the module's reads in one go so a scope switch can discard them
// together. Mirrors extensions/items.ts, which is the shape this follows.
import type { LibraryItem, LibraryState } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";
import type { InstalledModule, PendingModule } from "./bindings.ts";

// What a row is waiting for. A module owned by an ancestor scope is `inherited` and
// read-only here, because it is consented to and revoked where it lives — the same rule
// every other Library row follows.
function stateOf(scope: ScopeId, owner: ScopeId): LibraryState {
  return owner === scope ? "active" : "inherited";
}

export function moduleItems(
  installed: InstalledModule[],
  pending: PendingModule[],
  scope: ScopeId,
): LibraryItem[] {
  const rows: LibraryItem[] = [];
  for (const m of installed) {
    rows.push({
      kind: "module",
      key: `module/${m.scope}/${m.kind}`,
      scope: m.scope,
      state: stateOf(scope, m.scope),
      title: m.label,
      subtitle: m.kind,
      badge: "module",
      module: m,
    });
  }
  for (const p of pending) {
    rows.push({
      kind: "module",
      key: `module/${p.scope}/${p.name}`,
      scope: p.scope,
      state: "pending",
      title: p.def?.label ?? p.name,
      subtitle: p.name,
      badge: "module",
      // A definition that would not parse cannot be consented to — there is nothing to
      // consent TO. It is listed with its error rather than hidden, because a module
      // that silently fails to appear is a bug report.
      problem: p.error,
      pending: p,
    });
  }
  return rows;
}
