// Maps the two prompt files into Library rows, and holds the editor's draft shape.
// Pure: Library.svelte owns the fetch.
import type { PromptFileInfo, PromptFileKind } from "./system-bindings.ts";
import type { LibraryItem } from "../library/items.ts";

// The editor's state. No name field, unlike the prompt-template draft: there is exactly
// one file of each kind, so `kind` IS the identity.
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

// Both files are always listed, present or not, because a row is the only place the
// Library can say the file COULD exist and what it would do. Every other kind lists
// what exists; these two are singletons with fixed names.
export function promptFileItems(files: PromptFileInfo[]): LibraryItem[] {
  return files.map((file) => ({
    kind: file.kind,
    key: `${file.kind}/${PROMPT_FILE_NAMES[file.kind]}`,
    title: PROMPT_FILE_NAMES[file.kind],
    // "not set" rather than an empty subtitle: an absent file is a row you can act on
    // (Edit creates it), and a blank line would read as a rendering bug.
    subtitle: file.body === undefined ? "not set" : firstLine(file.body),
    file,
  }));
}
