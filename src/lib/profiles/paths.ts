// On-disk locations for profiles — a named base prompt plus a tool allowlist, one
// markdown file each (see docs/profiles.md). Two dirs inside a scope:
//
//   profiles/          LIVE. Selectable in a Chat module.
//   profiles/pending/  QUARANTINE. Agent-authored; nothing here is ever selectable,
//                      because every listing globs profiles/*.md without recursing.
//
// Deliberately OUTSIDE the scope's agent/ dir: pi auto-discovers SYSTEM.md, extensions
// and skills under agentDir, and a directory of markdown there invites it to interpret
// them. Runs Deno-side only.
import { scopeAgentDir, scopeDir, type ScopeId } from "../scope/paths.ts";

// A profile name is a filename AND a human-facing label, so it allows dashes where a
// tool name (tools/paths.ts) allows underscores — but is constrained the same way, so
// a name can never escape its directory.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function profilesDir(scope: ScopeId): string {
  return `${scopeDir(scope)}/profiles`;
}

export function pendingDir(scope: ScopeId): string {
  return `${profilesDir(scope)}/pending`;
}

// This scope's optional base prompt. pi's own filename and location: a user who already
// knows pi drops SYSTEM.md here and it works. pi only ever discovers the ONE agentDir it
// was given, so inheriting root's is service.ts's job (resolveBasePrompt).
export function basePromptPath(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/SYSTEM.md`;
}

export function assertProfileName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid profile name: ${name}`);
}

export function profilePath(scope: ScopeId, name: string): string {
  assertProfileName(name);
  return `${profilesDir(scope)}/${name}.md`;
}

export function pendingProfilePath(scope: ScopeId, name: string): string {
  assertProfileName(name);
  return `${pendingDir(scope)}/${name}.md`;
}

// Creating the quarantine dir creates its parent too, so one mkdir covers both.
export async function ensureProfileDirs(scope: ScopeId): Promise<void> {
  await Deno.mkdir(pendingDir(scope), { recursive: true });
}
