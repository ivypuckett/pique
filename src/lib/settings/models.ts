// Which models the model pickers offer, per provider.
//
// A connected provider can serve dozens of models and the pickers list all of them,
// which makes finding the two or three actually in use a scroll. The Providers section
// lets each provider's catalog be checked down to a short list; the pickers show only
// what is checked.
//
// A provider with NO entry has everything enabled — that is what a provider connected
// after this setting was written looks like, and what every provider looked like before
// it existed, so absent has to mean "all" rather than "none".
//
// Amazon Bedrock is the exception, because "all" there is actively unhelpful: its
// catalog is a static list of 114 ids, most of which cannot be invoked by the account
// looking at them (see chat/bedrock.ts). Only the `global.` inference profiles are
// dependable — they route from any region, and every model offered as one is also
// offered as a regional profile, so nothing is lost by starting there. So Bedrock
// starts with those checked and the rest merely unchecked: visible in Settings, one
// click away, and never hidden in a way the user cannot undo.

// provider id → the model ids enabled for it. An absent key means all of them.
export type ModelSelection = Record<string, string[]>;

// A model as either picker addresses one. Both ModelOption (providers.ts) and
// ModelInfo (chat/agent.ts) satisfy it.
type Model = { provider: string; id: string; name: string };

// The provider whose default is a subset rather than everything. Spelled here rather
// than imported from chat/bedrock.ts: this module is bundled into the webview, and
// that one reaches for Deno APIs the frontend has no business loading.
const BEDROCK = "amazon-bedrock";

// Whether a model is on before anyone has touched its provider's checklist.
export function isEnabledByDefault(provider: string, id: string): boolean {
  return provider !== BEDROCK || id.startsWith("global.");
}

export function isEnabled(
  selection: ModelSelection,
  provider: string,
  id: string,
): boolean {
  const list = selection[provider];
  return list === undefined
    ? isEnabledByDefault(provider, id)
    : list.includes(id);
}

// Check or uncheck one model. The provider's list is materialised on the first change
// from whatever was enabled by default, because up to that point "absent" was standing
// in for that set — toggling one entry has to leave every other entry as it appeared.
export function setEnabled(
  selection: ModelSelection,
  provider: string,
  allIds: string[],
  id: string,
  checked: boolean,
): ModelSelection {
  const current = selection[provider] ??
    allIds.filter((x) => isEnabledByDefault(provider, x));
  const next = checked
    ? (current.includes(id) ? current : [...current, id])
    : current.filter((x) => x !== id);
  return { ...selection, [provider]: next };
}

// What a picker lists. `keep` is a `provider/id` ref that stays listed even when it is
// unchecked — the model a conversation is already running, or the one an automaton has
// saved: hiding it would show the picker sitting on some other model's name.
export function visibleModels<T extends Model>(
  models: T[],
  selection: ModelSelection,
  keep?: string,
): T[] {
  return models.filter((m) =>
    isEnabled(selection, m.provider, m.id) || `${m.provider}/${m.id}` === keep
  );
}

// Checkbox order for one provider's catalog: enabled first, each half alphabetical.
// Snapshot this when the list opens rather than deriving it live — a checkbox that
// jumps to the top the moment it is ticked moves the next one under the pointer.
export function orderModels<T extends Model>(
  models: T[],
  selection: ModelSelection,
): T[] {
  return [...models].sort((a, b) => {
    const ea = isEnabled(selection, a.provider, a.id);
    const eb = isEnabled(selection, b.provider, b.id);
    if (ea !== eb) return ea ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
