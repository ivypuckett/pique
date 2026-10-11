// The one shape the Library list renders, and the order it renders in. Each kind's
// mapping INTO this shape lives in that kind's own directory (extensions/items.ts and
// so on), beside the bindings it reads; this module knows only what every row has in
// common. Pure — no fetching, no Deno APIs — so it is testable and safe to bundle.
import type { Extension } from "../extensions/bindings.ts";
import type { InstalledModule } from "../modules/bindings.ts";
import type { PromptInfo } from "../prompts/bindings.ts";
import type { SkillInfo } from "../skills/bindings.ts";
import type { PromptFileInfo } from "../prompts/system-bindings.ts";

// `system` and `appendix` are two kinds rather than one with a mode because they do
// different things — one replaces pi's preamble, the other is added on top — and a
// shared row would have to explain both on every line.
export type LibraryKind =
  | "extension"
  | "module"
  | "prompt"
  | "skill"
  | "system"
  | "appendix";

type Common = {
  // `${kind}/${identifier}` — the extension's `id`, the prompt's `name`, the skill's
  // `path`. Unique across kinds, which is what the expanded-row state keys on.
  key: string;
  title: string;
  subtitle?: string;
  // An extension's origin. Not the kind — the row renders that from `kind` itself.
  badge?: string;
  // Two severities, because the existing UI has two. `problem` is red: a template or a
  // skill whose frontmatter would not parse. `note` is dim: a skill whose frontmatter
  // `name:` disagrees with its basename. Collapsing them would either shout about a
  // naming quirk or whisper about a broken file.
  problem?: string;
  note?: string;
};

// A discriminated union rather than a common record with a `source: A | B | C` field:
// the shell's `{#if item.kind === ...}` branches then narrow to the right payload, so
// reaching for `item.ext` inside the prompt branch is a type error rather than a
// runtime undefined.
export type LibraryItem =
  | (Common & { kind: "extension"; ext: Extension })
  | (Common & { kind: "module"; module: InstalledModule })
  | (Common & { kind: "prompt"; prompt: PromptInfo })
  | (Common & { kind: "skill"; skill: SkillInfo })
  // Same payload for both, because the file is the same shape either way.
  | (Common & { kind: "system"; file: PromptFileInfo })
  | (Common & { kind: "appendix"; file: PromptFileInfo });

// The two prompt files sort FIRST: they steer everything below them, and unlike the
// rest they are always present as rows even when unset — so burying them under a long
// extension list would hide the fixed part of the page.
const KIND_ORDER: Record<LibraryKind, number> = {
  system: 0,
  appendix: 1,
  extension: 2,
  module: 3,
  prompt: 4,
  skill: 5,
};

// Kind first, then title. Copied before sorting: the caller holds `items` in $state, so
// sorting in place would shuffle the source of truth on every render.
export function sortItems(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title)
  );
}
