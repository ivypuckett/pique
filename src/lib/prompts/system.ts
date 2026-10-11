// The two optional prompt files in pi's agent dir (paths.ts), `SYSTEM.md` and
// `APPEND_SYSTEM.md`. pi's own filenames and locations, and pi discovers both itself, so
// a user who already knows pi drops a file there and it works — this module only reads
// and writes them for the Library's editors. Runs Deno-side only.
//
//   SYSTEM.md         replaces pi's own preamble outright.
//   APPEND_SYSTEM.md  is added on top of whichever base applies, pi's own preamble
//                     included — so house rules need no replacement preamble first.
//
// In a trusted project, pi reads the project's own `.pi/SYSTEM.md` and
// `.pi/APPEND_SYSTEM.md` from the working directory instead; those are the project's,
// edited there.
import { agentDir } from "../paths.ts";

// Which of the two files. Named for what each DOES, not for its filename: the Library
// rows show the filenames.
export type PromptFileKind = "system" | "appendix";

// One prompt file, present or not. `body` is undefined when there is no file — distinct
// from `""`, which cannot occur, because savePromptFile deletes rather than writing an
// empty one. The Library renders the difference as "not set".
export type PromptFileInfo = {
  kind: PromptFileKind;
  path: string;
  body?: string;
};

const KINDS: PromptFileKind[] = ["system", "appendix"];

export function promptFilePath(kind: PromptFileKind): string {
  return `${agentDir()}/${
    kind === "system" ? "SYSTEM.md" : "APPEND_SYSTEM.md"
  }`;
}

// Both files' text as one string, for telling whether either moved under a running
// conversation (chat/agent.ts reloadAgent). Synchronous: it is read beside a reload.
export function readPromptFiles(): string {
  return KINDS.map((kind) => {
    try {
      return Deno.readTextFileSync(promptFilePath(kind));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return "";
      throw err;
    }
  }).join("\0");
}

// Both files, present or not — always two entries, in the order the Library lists them.
export async function listPromptFiles(): Promise<PromptFileInfo[]> {
  return await Promise.all(KINDS.map(async (kind) => {
    const path = promptFilePath(kind);
    let body: string | undefined;
    try {
      body = await Deno.readTextFile(path);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    return { kind, path, body };
  }));
}

// A body that is empty or all whitespace DELETES the file instead: clearing the editor is
// how you say "not set", and an empty SYSTEM.md would replace pi's preamble with nothing.
export async function savePromptFile(
  kind: PromptFileKind,
  body: string,
): Promise<void> {
  if (body.trim() === "") return await deletePromptFile(kind);
  await Deno.mkdir(agentDir(), { recursive: true });
  await Deno.writeTextFile(promptFilePath(kind), body);
}

// Deleting a file that was never there is what "clear it" means, so a missing one is
// success rather than an error the Library would have to explain.
export async function deletePromptFile(kind: PromptFileKind): Promise<void> {
  try {
    await Deno.remove(promptFilePath(kind));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}
