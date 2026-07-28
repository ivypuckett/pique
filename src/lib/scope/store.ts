// Reactive state for the scope the Settings modal is editing.
//
// Unlike the app-level `settings` store, this one is per-scope and switchable, so the
// value and the scope it belongs to are held TOGETHER. Persisting a config against
// the wrong scope is the failure mode this guards against: a plain writable plus a
// separate "current scope" would write the outgoing scope's values into the incoming
// scope on every switch.
import { get, writable } from "svelte/store";
import { type ScopeConfig, scopeBindings } from "./bindings.ts";
import { ROOT } from "./paths.ts";

// The loaded config together with the scope it was read from. `loaded` stays false
// until the read resolves, which is what suppresses the write-back.
interface Editing {
  scope: string;
  config: ScopeConfig;
  loaded: boolean;
}

export const editing = writable<Editing>({ scope: ROOT, config: {}, loaded: false });

// Point the modal at a scope and read that scope's own config. Always marks the
// store unloaded first, so an in-flight switch can never persist to the old scope.
export async function editScope(scope: string): Promise<void> {
  editing.set({ scope, config: {}, loaded: false });
  const raw = await scopeBindings()?.scopeConfigRead({ scope });
  // A later switch may have landed while this read was in flight — drop the result
  // if it is no longer the scope being edited.
  editing.update((e) => e.scope !== scope ? e : { scope, config: raw ?? {}, loaded: true });
}

// Apply an edit to the scope currently being edited and persist it. Explicit rather
// than a subscription, so a write is always tied to the scope the user was editing.
export function updateScopeConfig(fn: (c: ScopeConfig) => ScopeConfig): void {
  const current = get(editing);
  if (!current.loaded) return;
  const config = fn(current.config);
  editing.set({ ...current, config });
  scopeBindings()?.scopeConfigWrite({ scope: current.scope, data: config });
}

// Record a chat default against one scope, read-modify-write on its OWN config (not
// the resolved one — writing back inherited values would silently pin root's choices
// into the workspace). Used when the user picks a model or thinking level in a Chat
// module: the pick becomes that workspace's default, leaving root's alone.
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
  // Keep the modal in sync if it happens to be editing this same scope.
  editing.update((e) =>
    e.scope !== scope || !e.loaded
      ? e
      : { ...e, config: { ...e.config, chat: { ...e.config.chat, ...patch } } }
  );
}
