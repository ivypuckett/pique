// Backend service for prompt templates: lists them, saves and deletes them. The prompts*
// win.bind handlers (desktop.ts) call it. A template is inert text that only runs when
// the user types its name (docs/prompts.md). Runs Deno-side only.
import { parsePrompt, type Prompt, promptFile } from "./parse.ts";
import {
  assertPromptName,
  ensurePromptDirs,
  promptPath,
  promptsDir,
} from "./paths.ts";

// An alias, not an interface, for the same reason Prompt is one (parse.ts).
export type PromptInfo = Prompt;

// Template names are the `*.md` basenames in a dir. A missing dir means "none yet", not
// an error. A basename that isn't a legal name is skipped rather than raising — the dir
// is user-editable, and one stray file must not break the whole listing.
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const name = entry.name.slice(0, -3);
      try {
        assertPromptName(name);
      } catch {
        continue;
      }
      names.push(name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return names.sort();
}

export async function listPrompts(): Promise<PromptInfo[]> {
  return await Promise.all(
    (await namesIn(promptsDir())).map(async (name) =>
      parsePrompt(name, await Deno.readTextFile(promptPath(name)))
    ),
  );
}

// Write a template, creating or replacing it.
export async function savePrompt(
  name: string,
  p: { description: string; argumentHint?: string; body: string },
): Promise<void> {
  assertPromptName(name);
  await ensurePromptDirs();
  await Deno.writeTextFile(promptPath(name), promptFile(p));
}

export async function deletePrompt(name: string): Promise<void> {
  await Deno.remove(promptPath(name));
}
