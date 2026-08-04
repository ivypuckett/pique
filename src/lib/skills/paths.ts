// On-disk location of a scope's skills. Deliberately INSIDE the scope's agent dir,
// because pi auto-discovers `<agentDir>/skills` and here that discovery is exactly
// what we want — the same reasoning that puts prompt templates there.
//
// pique lists and resolves skills; it does not install, review or quarantine them.
// A skill is markdown read by a model, not code that executes, so the extension
// review gate does not apply. Runs Deno-side only.
import { scopeAgentDir, type ScopeId } from "../scope/paths.ts";

// A skill name is a path basename AND the token an automaton names it by, so it is
// constrained the way a prompt template name is: no separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function skillsDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/skills`;
}

export function assertSkillName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid skill name: ${name}`);
}
