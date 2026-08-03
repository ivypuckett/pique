// On-disk locations for prompt templates — reusable markdown snippets a user invokes
// by typing `/name` in a Chat module (see docs/prompts.md). Two dirs inside a scope:
//
//   agent/prompts/          LIVE. pi discovers these itself.
//   agent/prompts/pending/  QUARANTINE. Agent-authored; nothing here is ever invocable.
//
// Deliberately INSIDE the scope's agent/ dir, because pi auto-discovers
// <agentDir>/prompts and here that discovery is exactly what we want. The quarantine dir
// is safe to nest under it because pi's directory scan does not recurse — verified
// against the SDK, and pinned by a test in service_test.ts.
import { scopeAgentDir, type ScopeId } from "../scope/paths.ts";

// A template name is a filename AND the token typed after `/`, so it is constrained the
// same way a scope id is: no separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function promptsDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/prompts`;
}

export function pendingDir(scope: ScopeId): string {
  return `${promptsDir(scope)}/pending`;
}

export function assertPromptName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid prompt name: ${name}`);
}

export function promptPath(scope: ScopeId, name: string): string {
  assertPromptName(name);
  return `${promptsDir(scope)}/${name}.md`;
}

export function pendingPromptPath(scope: ScopeId, name: string): string {
  assertPromptName(name);
  return `${pendingDir(scope)}/${name}.md`;
}

// Creating the quarantine dir creates its parent too, so one mkdir covers both.
export async function ensurePromptDirs(scope: ScopeId): Promise<void> {
  await Deno.mkdir(pendingDir(scope), { recursive: true });
}
