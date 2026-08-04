// On-disk locations for a scope's automatons. Four dirs under the scope:
//
//   automatons/            LIVE definitions — launchable.
//   automatons/pending/    QUARANTINE. Reserved: nothing writes here until
//                          define_automaton exists. It is created now so the live
//                          listing globs `automatons/*.md` non-recursively from the
//                          start, the way prompts/ and extensions/ already do.
//   automatons/runs/       One JSON record per run.
//   automatons/sessions/   pi session JSONL — the transcripts.
//
// Deliberately OUTSIDE the scope's agent/ dir: pi auto-discovers inside an agentDir,
// and a directory of markdown there invites it to interpret these files. Runs
// Deno-side only.
import { scopeDir, type ScopeId } from "../scope/paths.ts";

// The filename minus `.md` is the name, so it is constrained the way a prompt
// template name is: no separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function automatonsDir(scope: ScopeId): string {
  return `${scopeDir(scope)}/automatons`;
}

export function pendingDir(scope: ScopeId): string {
  return `${automatonsDir(scope)}/pending`;
}

export function runsDir(scope: ScopeId): string {
  return `${automatonsDir(scope)}/runs`;
}

export function sessionsDir(scope: ScopeId): string {
  return `${automatonsDir(scope)}/sessions`;
}

export function assertAutomatonName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid automaton name: ${name}`);
}

export function automatonPath(scope: ScopeId, name: string): string {
  assertAutomatonName(name);
  return `${automatonsDir(scope)}/${name}.md`;
}

// A run id is generated (crypto.randomUUID) rather than user-supplied, so it needs no
// validation beyond the shape it is given in run.ts.
export function runPath(scope: ScopeId, runId: string): string {
  if (!/^[a-z0-9-]+$/.test(runId)) throw new Error(`invalid run id: ${runId}`);
  return `${runsDir(scope)}/${runId}.json`;
}

export async function ensureAutomatonDirs(scope: ScopeId): Promise<void> {
  await Deno.mkdir(pendingDir(scope), { recursive: true });
  await Deno.mkdir(runsDir(scope), { recursive: true });
  await Deno.mkdir(sessionsDir(scope), { recursive: true });
}
