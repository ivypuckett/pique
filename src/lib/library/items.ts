// The one shape the Library list renders, and the grouping it renders in. Each kind's
// mapping INTO this shape lives in that kind's own directory (extensions/items.ts and
// so on), beside the bindings it reads; this module knows only what every row has in
// common. Pure — no fetching, no Deno APIs — so it is testable and safe to bundle.
import type { ScopeId } from "../scope/paths.ts";
import type { Extension } from "../extensions/bindings.ts";
import type { PromptInfo } from "../prompts/bindings.ts";
import type { SkillInfo } from "../skills/bindings.ts";
import type { AgentDef } from "../agents/bindings.ts";
import type { PromptFileInfo } from "../scope/prompt-bindings.ts";

// `system` and `appendix` are two kinds rather than one with a mode because they merge
// by OPPOSITE rules — nearest-wins against concatenate-down-the-chain (scope/prompt.ts)
// — and that difference is the thing a user will get wrong. A shared row would have to
// explain both on every line.
export type LibraryKind =
  | "extension"
  | "prompt"
  | "skill"
  | "subagent"
  | "system"
  | "appendix";

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
  | (Common & { kind: "skill"; skill: SkillInfo })
  | (Common & { kind: "subagent"; agent: AgentDef })
  // Same payload for both, because the file is the same shape either way — what differs
  // is the merge rule, which the kind itself names.
  | (Common & { kind: "system"; file: PromptFileInfo })
  | (Common & { kind: "appendix"; file: PromptFileInfo });

// The two prompt files sort FIRST: they steer everything below them, there are at most
// four of them, and unlike the rest they are always present as rows even when unset —
// so burying them under a long extension list would hide the fixed part of the page.
const KIND_ORDER: Record<LibraryKind, number> = {
  system: 0,
  appendix: 1,
  extension: 2,
  prompt: 3,
  skill: 4,
  subagent: 5,
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
