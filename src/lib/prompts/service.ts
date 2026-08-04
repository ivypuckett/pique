// Backend service for prompt templates: lists a scope's templates, saves and deletes
// them, and moves agent-written ones from quarantine to live. The prompts* win.bind
// handlers (desktop.ts) are the human half; agent-tools.ts is the agent half and can
// only ever write into pending. A human editing a template writes straight to live: a
// template is inert text that only runs when the user types its name, so there is nothing
// for a human to approve to themselves — the quarantine exists for the agent alone
// (docs/prompts.md).
// Runs Deno-side only.
import { parsePrompt, type Prompt, promptFile } from "./parse.ts";
import {
  assertPromptName,
  ensurePromptDirs,
  pendingDir,
  pendingPromptPath,
  promptPath,
  promptsDir,
} from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

export type PromptState = "live" | "pending";
// An alias, not an interface, for the same reason Prompt is one (parse.ts).
export type PromptInfo = Prompt & { scope: ScopeId; state: PromptState };

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

async function read(
  scope: ScopeId,
  name: string,
  state: PromptState,
): Promise<PromptInfo> {
  const path = state === "live"
    ? promptPath(scope, name)
    : pendingPromptPath(scope, name);
  return { ...parsePrompt(name, await Deno.readTextFile(path)), scope, state };
}

// One scope's own templates, both states in one call — the Library module's Prompts tab
// shows them together.
export async function listPrompts(scope: ScopeId): Promise<PromptInfo[]> {
  const [pending, live] = await Promise.all([
    namesIn(pendingDir(scope)),
    namesIn(promptsDir(scope)),
  ]);
  return [
    ...await Promise.all(pending.map((n) => read(scope, n, "pending"))),
    ...await Promise.all(live.map((n) => read(scope, n, "live"))),
  ];
}

// Every template invocable in `scope`: its own plus each ancestor's, root-first. A name
// defined in more than one scope appears ONCE, resolved to the nearest. That de-duplication
// is not cosmetic: pi loads both files and its expander takes the first match, so without
// this the `/` menu would list a shadowed twin that can never be invoked.
export async function listVisiblePrompts(
  scope: ScopeId,
): Promise<PromptInfo[]> {
  const byName = new Map<string, PromptInfo>();
  for (const s of chain(scope)) {
    for (const p of await listPrompts(s)) {
      if (p.state === "live") byName.set(p.name, p);
    }
  }
  return [...byName.values()];
}

// The live prompt dirs `scope` inherits from its ancestors, for pi's
// additionalPromptTemplatePaths. Unlike additionalExtensionPaths — which rejects a
// directory (extensions/local.ts) — this one accepts dirs, so the whole directory is
// handed over and a template added later needs no re-wiring. A scope's OWN dir is not
// listed: pi auto-discovers that from its agentDir, and listing it twice would load
// every template twice.
export function inheritedPromptDirs(scope: ScopeId): string[] {
  return chain(scope).filter((s) => s !== scope).map(promptsDir);
}

// Write a template into the live dir, creating or replacing it. This is the human path;
// an agent reaches pending only, via define_prompt.
export async function savePrompt(
  scope: ScopeId,
  name: string,
  p: { description: string; argumentHint?: string; body: string },
): Promise<void> {
  assertPromptName(name);
  await ensurePromptDirs(scope);
  await Deno.writeTextFile(promptPath(scope, name), promptFile(p));
}

// Approve = move quarantine → live, within the same scope. From here pi loads it for that
// scope (and, for root, for every workspace). Rename replaces any same-named live file, so
// approving a redefinition supersedes the old one rather than leaving both.
export async function approvePrompt(
  scope: ScopeId,
  name: string,
): Promise<void> {
  await ensurePromptDirs(scope);
  await Deno.rename(pendingPromptPath(scope, name), promptPath(scope, name));
}

export async function rejectPrompt(
  scope: ScopeId,
  name: string,
): Promise<void> {
  await Deno.remove(pendingPromptPath(scope, name));
}

// Delete outright, from whichever dir it is in.
export async function deletePrompt(
  scope: ScopeId,
  name: string,
  state: PromptState,
): Promise<void> {
  await Deno.remove(
    state === "live" ? promptPath(scope, name) : pendingPromptPath(scope, name),
  );
}
