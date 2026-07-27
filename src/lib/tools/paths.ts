// On-disk locations for user- and agent-defined tools (pi extensions that call
// pi.registerTool). Two sibling dirs under ~/.pique/agent:
//
//   extensions/  LIVE. pi auto-discovers `<agentDir>/extensions/*.ts` and executes
//                every module here at session start (agent.ts passes agentDir).
//   pending/     QUARANTINE. Not an auto-discovered location, so nothing here ever
//                runs. Agent-authored tools land here; approving one is a rename
//                into extensions/.
//
// The file's location IS the approval record — in extensions/ means approved — so
// there is no separate ledger that can drift from what actually loads.
// Runs Deno-side only.
import { piAgentDir } from "../settings/file.ts";

// Tool names become filenames, so constrain them so a name can never escape its
// dir (no separators / traversal), mirroring kanban/paths.ts's ID_RE. The shape is
// also what pi wants of an LLM-callable tool name.
const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function liveDir(): string {
  return `${piAgentDir()}/extensions`;
}

export function pendingDir(): string {
  return `${piAgentDir()}/pending`;
}

export function assertToolName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid tool name: ${name}`);
}

export function livePath(name: string): string {
  assertToolName(name);
  return `${liveDir()}/${name}.ts`;
}

export function pendingPath(name: string): string {
  assertToolName(name);
  return `${pendingDir()}/${name}.ts`;
}

// Ensure both dirs exist before writing into either.
export async function ensureToolDirs(): Promise<void> {
  await Deno.mkdir(liveDir(), { recursive: true });
  await Deno.mkdir(pendingDir(), { recursive: true });
}
