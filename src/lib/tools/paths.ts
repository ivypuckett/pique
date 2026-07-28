// On-disk locations for user- and agent-defined tools (pi extensions that call
// pi.registerTool). Two sibling dirs inside a scope's agent dir (scope/paths.ts):
//
//   extensions/  LIVE. pi auto-discovers `<agentDir>/extensions/*.ts` and executes
//                every module here at session start (agent.ts passes agentDir).
//   pending/     QUARANTINE. Not an auto-discovered location, so nothing here ever
//                runs. Agent-authored tools land here; approving one is a rename
//                into extensions/.
//
// The file's location IS the approval record — in extensions/ means approved — so
// there is no separate ledger that can drift from what actually loads.
//
// Every path is keyed by scope: a tool approved in ws-1 is ws-1's alone, while a tool
// approved in root is inherited by every workspace (see tools/service.ts
// inheritedExtensionFiles). Runs Deno-side only.
import { ensureScopeDirs, scopeAgentDir, type ScopeId } from "../scope/paths.ts";

// Tool names become filenames, so constrain them so a name can never escape its
// dir (no separators / traversal), mirroring scope/paths.ts's ID_RE. The shape is
// also what pi wants of an LLM-callable tool name.
const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function liveDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/extensions`;
}

export function pendingDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/pending`;
}

export function assertToolName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid tool name: ${name}`);
}

export function livePath(scope: ScopeId, name: string): string {
  assertToolName(name);
  return `${liveDir(scope)}/${name}.ts`;
}

export function pendingPath(scope: ScopeId, name: string): string {
  assertToolName(name);
  return `${pendingDir(scope)}/${name}.ts`;
}

// Ensure both dirs exist before writing into either.
export async function ensureToolDirs(scope: ScopeId): Promise<void> {
  await ensureScopeDirs(scope);
}
