// A scope's optional base system prompt: `agent/SYSTEM.md`. pi's own filename and
// location, so a user who already knows pi drops the file there and it works — but pi
// only ever discovers the ONE agentDir it was handed, so root's would be invisible to a
// workspace. Resolving it along the chain here is what makes it inherit at all, and is
// why chat/agent.ts passes the winner to pi explicitly. Runs Deno-side only.
import { chain, scopeAgentDir, type ScopeId } from "./paths.ts";

export function basePromptPath(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/SYSTEM.md`;
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
