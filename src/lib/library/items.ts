// The one shape the Library list renders, and the grouping it renders in. Each kind's
// mapping INTO this shape lives in that kind's own directory (extensions/items.ts and
// so on), beside the bindings it reads; this module knows only what every row has in
// common. Pure — no fetching, no Deno APIs — so it is testable and safe to bundle.
import type { ScopeId } from "../scope/paths.ts";
import type { Extension } from "../extensions/bindings.ts";
import type { PromptInfo } from "../prompts/bindings.ts";
import type { SkillInfo } from "../skills/bindings.ts";

export type LibraryKind = "extension" | "prompt" | "skill";

// What the row is waiting for, NOT what kind of thing it is. `pending` is the review
// gate; `inherited` came from an ancestor scope and is read-only here, because it is
// enabled and revoked where it lives.
export type LibraryState = "pending" | "active" | "inherited";

type Common = {
  // `${kind}/${scope}/${identifier}` — the extension's `id`, the prompt's `name`, the
  // skill's `path`. Unique across kinds AND scopes, which is what the expanded-row
  // state keys on: the same name can exist in root and in a workspace, and expanding
  // one must not expand the other.
  key: string;
  scope: ScopeId;
  state: LibraryState;
  title: string;
  subtitle?: string;
  // An extension's origin, or a prompt's "shadowed" marker. Not the kind — the row
  // renders that from `kind` itself.
  badge?: string;
  // Two severities, because the existing UI has two. `problem` is red: a template or a
  // skill whose frontmatter would not parse. `note` is dim: a skill whose frontmatter
  // `name:` disagrees with the basename an automaton has to use. Collapsing them would
  // either shout about a naming quirk or whisper about a broken file.
  problem?: string;
  note?: string;
};

// A discriminated union rather than a common record with a `source: A | B | C` field:
// the shell's `{#if item.kind === ...}` branches then narrow to the right payload, so
// reaching for `item.ext` inside the prompt branch is a type error rather than a
// runtime undefined.
export type LibraryItem =
  | (Common & { kind: "extension"; ext: Extension })
  | (Common & { kind: "prompt"; prompt: PromptInfo })
  | (Common & { kind: "skill"; skill: SkillInfo });

const KIND_ORDER: Record<LibraryKind, number> = {
  extension: 0,
  prompt: 1,
  skill: 2,
};

export type LibraryGroups = {
  pending: LibraryItem[];
  active: LibraryItem[];
  inherited: LibraryItem[];
};

// Copied before sorting: the caller holds `items` in $state and derives groups from it,
// so sorting in place would shuffle the source of truth on every render.
function sorted(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title)
  );
}

export function groupItems(items: LibraryItem[]): LibraryGroups {
  return {
    pending: sorted(items.filter((i) => i.state === "pending")),
    active: sorted(items.filter((i) => i.state === "active")),
    inherited: sorted(items.filter((i) => i.state === "inherited")),
  };
}
