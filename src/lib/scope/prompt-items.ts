// Maps a scope's two prompt files into Library rows, and holds the editor's draft
// shape. Pure: Library.svelte owns the fetch.
import type { PromptFileInfo, PromptFileKind } from "./prompt-bindings.ts";
import type { LibraryItem, LibraryState } from "../library/items.ts";
import { ROOT, type ScopeId } from "./paths.ts";

// The editor's state. No name field, unlike the prompt-template and subagent drafts:
// there is exactly one file of each kind per scope, so `kind` IS the identity.
export type PromptFileDraft = {
  kind: PromptFileKind;
  body: string;
};

// The filenames, which are what the rows are titled — a user who goes looking on disk
// finds these, and they are pi's own names rather than pique's invention.
export const PROMPT_FILE_NAMES: Record<PromptFileKind, string> = {
  system: "SYSTEM.md",
  appendix: "APPEND_SYSTEM.md",
};

// The first line with anything on it, so a row previews the file rather than a blank.
// Truncation is the row's job (it has the width); this only picks the line.
function firstLine(body: string): string {
  return body.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
}

function row(
  file: PromptFileInfo,
  state: LibraryState,
  badge?: string,
): LibraryItem {
  return {
    kind: file.kind,
    key: `${file.kind}/${file.scope}/${PROMPT_FILE_NAMES[file.kind]}`,
    scope: file.scope,
    state,
    title: PROMPT_FILE_NAMES[file.kind],
    // "not set" rather than an empty subtitle: an absent file is a row you can act on
    // (Edit creates it), and a blank line would read as a rendering bug.
    subtitle: file.body === undefined ? "not set" : firstLine(file.body),
    badge,
    file,
  };
}

// `own` is the scope's two files, present or not — both are always listed, because a
// row is the only place the Library can say the file COULD exist here and what it would
// do. Every other kind lists what exists; these two are singletons with fixed names, so
// there is nothing to enumerate and nothing for a "New…" button to name.
//
// `root` is root's two, listed only when they exist: an inherited "not set" row is a
// row about a file you cannot edit from here that also isn't there. ROOT itself must be
// passed an empty array, since it inherits from nothing.
//
// The badges carry the merge rule, and only where it is actually load-bearing — the two
// kinds disagree about what a root file and a workspace file do together.
export function promptFileItems(
  own: PromptFileInfo[],
  root: PromptFileInfo[],
  _scope: ScopeId,
): LibraryItem[] {
  const rootByKind = new Map(root.map((f) => [f.kind, f]));
  const items = own.map((f) => {
    const inherited = rootByKind.get(f.kind);
    // Only when BOTH exist: the badge describes what this file does alongside root's,
    // and an absent one is not applied after anything.
    const badge = f.kind === "appendix" && f.body !== undefined &&
        inherited?.body !== undefined
      ? "applied after root's"
      : undefined;
    return row(f, "active", badge);
  });

  for (const f of root) {
    if (f.body === undefined) continue;
    const ownFile = own.find((o) => o.kind === f.kind);
    // A workspace SYSTEM.md replaces root's outright, so root's is listed but can never
    // be the one that runs — the same marker agentItems uses for a shadowed definition.
    // An appendix is never shadowed: both apply, root's first.
    const badge = f.kind === "system"
      ? (ownFile?.body !== undefined ? "shadowed" : undefined)
      : "applied first";
    items.push(row({ ...f, scope: ROOT }, "inherited", badge));
  }
  return items;
}
