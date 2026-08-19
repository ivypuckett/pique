// On-disk location for a scope's subagent definitions: markdown files a chat agent's
// run_subagent tool can delegate to (agent-tools.ts). One LIVE dir only — unlike
// prompts/extensions there is no pending/ quarantine, and that is deliberate rather
// than unfinished (docs/security.md).
//
// Not because a definition is "only text" — a prompt template is only text too, and
// that one IS quarantined when an agent writes it. The reason is that a subagent is
// strictly less capable than the agent that defines it: it runs a subset of the
// parent's tools, chosen by the parent, and the parent already holds `write` and
// `bash`. Anything a subagent could be told to do, the definer can do directly and
// with less ceremony, so there is no escalation for a gate to stand in front of.
//
// What that accepts: a definition written into ROOT is inherited by every workspace
// and re-applied in later sessions, so an instruction that arrived by prompt injection
// persists past the conversation that introduced it. Recorded in security.md rather
// than papered over.
//
// Deliberately INSIDE the scope's agent/ dir (scope/paths.ts), alongside prompts/ and
// extensions/, even though pi itself never discovers this one — it belongs to the same
// scope-owned config tree.
import { scopeAgentDir, type ScopeId } from "../scope/paths.ts";

// An agent's name is its filename stem, the same rule prompts/paths.ts holds template
// names to: no separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function agentsDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/agents`;
}

export function assertAgentName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid agent name: ${name}`);
}

export function agentPath(scope: ScopeId, name: string): string {
  assertAgentName(name);
  return `${agentsDir(scope)}/${name}.md`;
}

export async function ensureAgentDirs(scope: ScopeId): Promise<void> {
  await Deno.mkdir(agentsDir(scope), { recursive: true });
}
