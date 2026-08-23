// Frontend half of the subagents binding contract. The backend half is the agents*
// win.bind handlers in src/desktop.ts (delegating to agents/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { AgentDef } from "./parse.ts";
import type { PromoteResult } from "../scope/promote.ts";
export type { AgentDef, PromoteResult };

// Every call names the scope it acts on: a definition belongs to one scope, and saving
// it in root is what makes it runnable from every workspace. `agentsList` is a scope's
// OWN definitions — the ones it can edit or delete; what run_subagent can actually
// reach (its own plus root's) is resolved backend-side, per call.
//
// There is no approve/reject pair here, unlike prompts: subagent definitions have no
// quarantine, and agents/paths.ts records why.
export interface AgentBindings {
  agentsList(arg: { scope: string }): Promise<AgentDef[]>;
  agentsSave(
    arg: {
      scope: string;
      name: string;
      description: string;
      tools?: string[];
      model?: string;
      systemPrompt: string;
    },
  ): Promise<unknown>;
  agentsDelete(arg: { scope: string; name: string }): Promise<unknown>;
  // Moves the definition into root, where every workspace inherits it. Returns
  // `{ conflict: true }` instead of acting when root already has that name; the caller
  // asks the user, then calls again with `overwrite`.
  agentsPromote(
    arg: { scope: string; name: string; overwrite?: boolean },
  ): Promise<PromoteResult>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Library then
// shows a desktop-only note, same as prompts/extensions/skills.
export function agentBindings(): AgentBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as AgentBindings) : null;
}
