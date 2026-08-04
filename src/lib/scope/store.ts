// Per-scope config helpers.
//
// A scope's config is read-modify-written against that scope's OWN file, never the
// resolved one — writing back inherited values would silently pin root's choices into
// the workspace.
import { scopeBindings, type ScopeConfig } from "./bindings.ts";

// Used when the user picks a model or thinking level in a Chat module: the pick becomes
// that workspace's default, leaving root's alone.
export async function patchScopeChat(
  scope: string,
  patch: NonNullable<ScopeConfig["chat"]>,
): Promise<void> {
  const b = scopeBindings();
  if (!b) return;
  const own = (await b.scopeConfigRead({ scope })) ?? {};
  await b.scopeConfigWrite({
    scope,
    data: { ...own, chat: { ...own.chat, ...patch } },
  });
}
