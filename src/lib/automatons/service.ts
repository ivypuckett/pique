// Backend service for automatons: what a scope has, and reading/writing one. The
// automaton* win.bind handlers (desktop.ts) are its only caller besides run.ts.
// Shaped on prompts/service.ts, which does the same job for templates.
//
// There is no approve/reject pair here. `pending/` exists (paths.ts) but nothing
// writes into it until define_automaton lands, so quarantine has no lifecycle yet —
// only the guarantee that a file there is not launchable. Runs Deno-side only.
import { type Automaton, automatonFile, parseAutomaton } from "./parse.ts";
import {
  assertAutomatonName,
  automatonPath,
  automatonsDir,
  ensureAutomatonDirs,
} from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";
import {
  automatonClosure,
  type ClosureFile,
  isApproved,
  recordApproval,
  revokeApproval,
} from "./approval.ts";
import { digestOf } from "../digest.ts";

// An alias, not an interface, for the same reason Automaton is one (parse.ts).
export type AutomatonInfo = Automaton & { scope: ScopeId };

// Definition names are the `*.md` basenames in the live dir. A missing dir means
// "none yet", not an error. A basename that is not a legal name is skipped rather
// than raising — the dir is user-editable and one stray file must not break the list.
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const name = entry.name.slice(0, -3);
      try {
        assertAutomatonName(name);
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

// Read and parse one file, or undefined if it is gone. The dir is user-editable and
// listAutomatons runs read() for every name namesIn() just found, so a delete landing
// in between (another tab, an agent run) is a real race, not a hypothetical — the same
// tolerance skills/service.ts's readMeta already gives a vanished skill file. Anything
// other than NotFound (permissions, I/O) still throws: that is not "the file is gone",
// it is "something is wrong", and swallowing it would hide a real failure as an empty
// listing.
async function read(
  scope: ScopeId,
  name: string,
): Promise<AutomatonInfo | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(automatonPath(scope, name));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
  }
  return { ...parseAutomaton(name, text), scope };
}

// One scope's own automatons. The listing globs the live dir without recursing, so
// `pending/` can never appear here.
export async function listAutomatons(scope: ScopeId): Promise<AutomatonInfo[]> {
  const names = await namesIn(automatonsDir(scope));
  const infos = await Promise.all(names.map((name) => read(scope, name)));
  return infos.filter((a): a is AutomatonInfo => a !== undefined);
}

// Every automaton launchable in `scope`: its own plus each ancestor's, nearest
// winning. Chain order is furthest-first, so a later set() shadows an earlier one.
export async function listVisibleAutomatons(
  scope: ScopeId,
): Promise<AutomatonInfo[]> {
  const byName = new Map<string, AutomatonInfo>();
  for (const s of chain(scope)) {
    for (const a of await listAutomatons(s)) byName.set(a.name, a);
  }
  return [...byName.values()];
}

// The definition a launch runs, nearest scope first, or undefined when no scope on
// the chain has it. `scope` on the result is where the FILE lives, which may be an
// ancestor; the run itself always belongs to the launching scope (run.ts).
export async function resolveAutomaton(
  scope: ScopeId,
  name: string,
): Promise<AutomatonInfo | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    const hit = (await listAutomatons(s)).find((a) => a.name === name);
    if (hit) return hit;
  }
  return undefined;
}

// Write a definition into the live dir, creating or replacing it. Human path only;
// there is no agent path yet.
export async function saveAutomaton(
  scope: ScopeId,
  name: string,
  a: {
    description: string;
    prompt: string;
    extensions: string[];
    skills: string[];
    // Absent means unrestricted; see parse.ts. Passed through rather than defaulted, so
    // a caller that does not know about the key cannot turn `tools: []` into every
    // builtin by omitting it.
    tools?: string[];
    model?: string;
    cron?: string;
    kanban?: string;
    // Absent is unlimited; see parse.ts. Passed through rather than defaulted for the
    // same reason `tools` is.
    wip?: number;
  },
): Promise<void> {
  assertAutomatonName(name);
  await ensureAutomatonDirs(scope);
  await Deno.writeTextFile(automatonPath(scope, name), automatonFile(a));
}

export async function deleteAutomaton(
  scope: ScopeId,
  name: string,
): Promise<void> {
  await Deno.remove(automatonPath(scope, name));
  // An approval names a definition that no longer exists. Dropped so a later file of the
  // same name does not inherit the dead entry's standing — the digest would refuse it
  // anyway, but leaving the row would be a claim the manifest cannot support.
  await revokeApproval(scope, name);
}

// ---------------------------------------------------------------------------
// Unattended-firing approval. The by-name half of approval.ts, which the win.bind
// handlers and the Automatons module call; the digest half lives there. Only a scope's
// OWN definitions can be approved in it, because only its own ever fire there — both
// triggers list own definitions, never inherited ones (schedule.ts decision 1).
// ---------------------------------------------------------------------------

// This scope's own definition, or a refusal naming what was asked for. Inherited
// definitions are deliberately not reachable: approving root's automaton from a
// workspace would record an approval in a scope that will never consult it.
async function own(scope: ScopeId, name: string): Promise<AutomatonInfo> {
  assertAutomatonName(name);
  const a = await read(scope, name);
  if (!a) throw new Error(`automaton not found in ${scope}: ${name}`);
  return a;
}

// What a human reads before approving: every file the run would actually consult, and
// the digest over them to hand back to approveAutomaton. The counterpart of
// readExtension (extensions/service.ts) and the same bargain — the digest is taken here
// so that what was displayed and what gets approved are provably the same bytes.
export async function reviewAutomaton(
  scope: ScopeId,
  name: string,
): Promise<{ files: ClosureFile[]; digest: string }> {
  const a = await own(scope, name);
  const files = await automatonClosure(scope, a);
  return { files, digest: await digestOf(files) };
}

export async function approveAutomaton(
  scope: ScopeId,
  name: string,
  expectDigest: string,
): Promise<void> {
  await recordApproval(scope, await own(scope, name), expectDigest);
}

export async function revokeAutomatonApproval(
  scope: ScopeId,
  name: string,
): Promise<void> {
  assertAutomatonName(name);
  await revokeApproval(scope, name);
}

// The names in `scope` whose approval is CURRENTLY good — present in the manifest and
// still matching what is on disk. What the Automatons module badges from, so a
// definition edited since it was approved shows as needing another look rather than
// silently not firing.
export async function approvedNames(scope: ScopeId): Promise<string[]> {
  const names: string[] = [];
  for (const a of await listAutomatons(scope)) {
    if (await isApproved(scope, a)) names.push(a.name);
  }
  return names;
}
