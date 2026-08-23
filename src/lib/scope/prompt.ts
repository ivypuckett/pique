// A scope's two optional prompt files, `agent/SYSTEM.md` and `agent/APPEND_SYSTEM.md`.
// pi's own filenames and locations, so a user who already knows pi drops a file there
// and it works — but pi only ever discovers the ONE agentDir it was handed, so root's
// would be invisible to a workspace. Resolving them along the chain here is what makes
// them inherit at all, and is why chat/agent.ts passes the results to pi explicitly.
//
// The two merge by OPPOSITE rules, deliberately:
//
//   SYSTEM.md         nearest wins — one file replaces pi's preamble outright, and a
//                     workspace's shadows root's. Two of them cannot both be "the"
//                     preamble, so there is nothing to concatenate.
//   APPEND_SYSTEM.md  concatenates, root's first — root holds house rules, each
//                     workspace adds its archetype on top, and BOTH apply. This is the
//                     one that lets a Swift workspace and a Go workspace each get
//                     expert guidance without either seeing the other's.
//
// The appendix is also the one that works when there is no SYSTEM.md anywhere: pi adds
// it in both branches of buildSystemPrompt, so house rules land on top of pi's own
// preamble rather than requiring you to replace it first. Runs Deno-side only.
import { chain, ensureScopeDirs, scopeAgentDir, type ScopeId } from "./paths.ts";

// Which of a scope's two prompt files. Named for what each DOES, not for its filename:
// the Library rows show the filenames, and this is what the merge rules key on.
export type PromptFileKind = "system" | "appendix";

// One scope's one prompt file, present or not. `body` is undefined when there is no
// file — distinct from `""`, which cannot occur, because savePromptFile deletes rather
// than writing an empty one. The Library renders the difference as "not set".
export type PromptFileInfo = {
  scope: ScopeId;
  kind: PromptFileKind;
  path: string;
  body?: string;
};

export function basePromptPath(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/SYSTEM.md`;
}

// pi's filename for the appendix, discovered from its single agentDir the same way
// SYSTEM.md is — and inherited here for the same reason it isn't there.
export function appendPromptPath(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/APPEND_SYSTEM.md`;
}

export function promptFilePath(scope: ScopeId, kind: PromptFileKind): string {
  return kind === "system" ? basePromptPath(scope) : appendPromptPath(scope);
}

// The nearest SYSTEM.md on the chain, or undefined when none exists. Undefined must
// reach pi AS undefined — that is what keeps pi's own preamble as the default.
//
// Synchronous because pi's resource loader calls it from inside its own reload(), which
// gives it no place to await: chat/agent.ts hands this over as a callback rather than a
// string, so an edited SYSTEM.md is re-read on `/reload` (extensions.md).
export function resolveBasePrompt(scope: ScopeId): string | undefined {
  for (const s of [...chain(scope)].reverse()) {
    try {
      return Deno.readTextFileSync(basePromptPath(s));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return undefined;
}

// Every APPEND_SYSTEM.md on the chain, ROOT'S FIRST — the order they are applied in,
// and the order pi joins them in. Not reversed like resolveBasePrompt: this one is not
// looking for a winner, it is collecting all of them.
//
// The empty array is the "none anywhere" answer, and pi treats it as no appendix at
// all. That is also why an empty array must still be handed over rather than omitted:
// pi falls back to discovering its own agentDir's file when given nothing, which would
// re-read the scope's own copy that this already includes.
//
// Synchronous for the same reason resolveBasePrompt is — pi's resource loader calls it
// from inside its own reload(), which gives it no place to await.
export function resolveAppendPrompts(scope: ScopeId): string[] {
  const texts: string[] = [];
  for (const s of chain(scope)) {
    try {
      const text = Deno.readTextFileSync(appendPromptPath(s));
      // pi joins these with a blank line between, so a whitespace-only file would
      // contribute nothing but blank lines. savePromptFile never writes one; this
      // covers the file being edited on disk.
      if (text.trim() !== "") texts.push(text);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return texts;
}

// Both of ONE scope's prompt files, present or not — always two entries, in the order
// the Library lists them. The scope's OWN files only: what an agent there actually
// runs with comes from the two resolvers above.
export async function listPromptFiles(
  scope: ScopeId,
): Promise<PromptFileInfo[]> {
  const kinds: PromptFileKind[] = ["system", "appendix"];
  return await Promise.all(kinds.map(async (kind) => {
    const path = promptFilePath(scope, kind);
    let body: string | undefined;
    try {
      body = await Deno.readTextFile(path);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    return { scope, kind, path, body };
  }));
}

// Write one of the scope's prompt files. A body that is empty or all whitespace DELETES
// it instead: clearing the editor is how you say "not here", and the two resolvers read
// absence as "fall back down the chain" while an empty file would resolve to `""` — a
// workspace SYSTEM.md that shadows root's and then contributes nothing, which no row in
// the Library could truthfully describe.
export async function savePromptFile(
  scope: ScopeId,
  kind: PromptFileKind,
  body: string,
): Promise<void> {
  if (body.trim() === "") return await deletePromptFile(scope, kind);
  await ensureScopeDirs(scope);
  await Deno.writeTextFile(promptFilePath(scope, kind), body);
}

// Deleting a file that was never there is what "clear it" means, so a missing one is
// success rather than an error the Library would have to explain.
export async function deletePromptFile(
  scope: ScopeId,
  kind: PromptFileKind,
): Promise<void> {
  try {
    await Deno.remove(promptFilePath(scope, kind));
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}
