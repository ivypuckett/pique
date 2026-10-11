// Maps the prompt templates into Library rows, and holds the editor's draft shape.
// Pure: Library.svelte owns the fetch.
import type { PromptInfo } from "./bindings.ts";
import type { LibraryItem } from "../library/items.ts";

// The create/edit form's state. It lives in the shell rather than in PromptEditor, which
// only renders it.
export type Draft = {
  name: string;
  description: string;
  argumentHint: string;
  body: string;
  // Whether the name is still editable. Renaming an existing template would save under
  // the new name and leave the old file behind.
  creating: boolean;
};

export function promptItems(prompts: PromptInfo[]): LibraryItem[] {
  return prompts.map((prompt) => ({
    kind: "prompt" as const,
    key: `prompt/${prompt.name}`,
    title: `/${prompt.name}`,
    subtitle: prompt.description,
    problem: prompt.error,
    prompt,
  }));
}
