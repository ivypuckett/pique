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
// looking at them: regional inference profiles (`us.`, `eu.`, …) work only from their
// own geography, and a bare id with a profile variant is refused on demand. Only the
// `global.` inference profiles are dependable — they route from any region, and every
// model offered as one is also offered as a regional profile, so nothing is lost by
// starting there. So Bedrock starts with those checked and the rest merely
// unchecked: visible in Settings, a click away (one per geography, see modelGroups),
// and never hidden in a way the user cannot undo.

// provider id → the model ids enabled for it. An absent key means all of them.
export type ModelSelection = Record<string, string[]>;

// A model as either picker addresses one. Both ModelOption (providers.ts) and
// ModelInfo (chat/agent.ts) satisfy it.
type Model = { provider: string; id: string; name: string };

// The provider whose default is a subset rather than everything.
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
  return setManyEnabled(selection, provider, allIds, [id], checked);
}

// Check or uncheck several at once — a whole group (see modelGroups).
export function setManyEnabled(
  selection: ModelSelection,
  provider: string,
  allIds: string[],
  ids: string[],
  checked: boolean,
): ModelSelection {
  const current = selection[provider] ??
    allIds.filter((x) => isEnabledByDefault(provider, x));
  const next = checked
    ? [...current, ...ids.filter((id) => !current.includes(id))]
    : current.filter((x) => !ids.includes(x));
  return { ...selection, [provider]: next };
}

// Bedrock's catalog sorted into where each model can be called from, so the checklist
// can switch a geography on in one click instead of the picker guessing at it: the
// inference profiles by their id prefix, and everything else as on-demand. Other
// providers have no groups.
const BEDROCK_GROUPS: [string, string][] = [
  ["global", "Global"],
  ["us", "US"],
  ["eu", "EU"],
  ["apac", "APAC"],
  ["jp", "JP"],
  ["au", "AU"],
  ["us-gov", "GovCloud"],
];

export function modelGroups(
  provider: string,
  ids: string[],
): { label: string; ids: string[] }[] {
  if (provider !== BEDROCK) return [];
  const labelOf = (id: string) =>
    BEDROCK_GROUPS.find(([prefix]) => prefix === id.split(".")[0])?.[1] ??
      "On-demand";
  return [...BEDROCK_GROUPS.map(([, label]) => label), "On-demand"]
    .map((label) => ({ label, ids: ids.filter((id) => labelOf(id) === label) }))
    .filter((g) => g.ids.length > 0);
}

// What a picker lists. `keep` is a `provider/id` ref that stays listed even when it is
// unchecked — the model a conversation is already running: hiding it would show the picker sitting on some other model's name.
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
