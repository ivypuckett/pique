// Backend service for defined tools: lists the two dirs of a scope, reads a tool's
// source for human review, and moves files between quarantine and live. The tools*
// win.bind handlers (desktop.ts) are the human half; agent-tools.ts is the agent half
// and can only ever write into pending. Every operation names the scope it acts on.
// Runs Deno-side only.
import { ensureToolDirs, liveDir, livePath, pendingDir, pendingPath } from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

export type ToolState = "pending" | "approved";
export type DefinedTool = { name: string; state: ToolState; scope: ScopeId };

// Tool names are the `*.ts` basenames in a dir. A missing dir means "none yet"
// (nothing has been defined in this scope), not an error.
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) names.push(entry.name.slice(0, -3));
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return names.sort();
}

// One scope's own tools, both lists in one call — the review UI always shows them
// together.
export async function listTools(scope: ScopeId): Promise<DefinedTool[]> {
  const [pending, approved] = await Promise.all([
    namesIn(pendingDir(scope)),
    namesIn(liveDir(scope)),
  ]);
  return [
    ...pending.map((name): DefinedTool => ({ name, state: "pending", scope })),
    ...approved.map((name): DefinedTool => ({ name, state: "approved", scope })),
  ];
}

// Every tool an agent in `scope` can call: its own, plus each ancestor's. Ordered
// root-first so the UI shows inherited tools above local ones.
export async function listVisibleTools(scope: ScopeId): Promise<DefinedTool[]> {
  const out: DefinedTool[] = [];
  for (const s of chain(scope)) out.push(...await listTools(s));
  return out;
}

// The approved extension modules `scope` inherits from its ancestors, as absolute
// FILE paths. pi's additionalExtensionPaths rejects a directory (verified against
// the SDK: a dir yields "Cannot find module" and the tools silently don't load), so
// this globs the files. A scope's OWN extensions are not listed — pi auto-discovers
// those from its agentDir.
export async function inheritedExtensionFiles(scope: ScopeId): Promise<string[]> {
  const ancestors = chain(scope).filter((s) => s !== scope);
  const files: string[] = [];
  for (const s of ancestors) {
    for (const name of await namesIn(liveDir(s))) files.push(livePath(s, name));
  }
  return files;
}

// The source a human reviews before approving — the exact bytes that will execute.
export async function readSource(
  scope: ScopeId,
  name: string,
  state: ToolState,
): Promise<string> {
  return await Deno.readTextFile(
    state === "pending" ? pendingPath(scope, name) : livePath(scope, name),
  );
}

// Approve = move quarantine → live, within the same scope. From here pi loads it for
// that scope (and, for root, for every workspace) at the next session start. Rename
// replaces any same-named live file, so re-approving a redefinition supersedes the
// old one rather than leaving both.
export async function approveTool(scope: ScopeId, name: string): Promise<void> {
  await ensureToolDirs(scope);
  await Deno.rename(pendingPath(scope, name), livePath(scope, name));
}

export async function rejectTool(scope: ScopeId, name: string): Promise<void> {
  await Deno.remove(pendingPath(scope, name));
}

// Revoke an already-approved tool: delete it outright. Sessions already running keep
// it until they restart (see docs/scopes.md). Revoking in root removes it from every
// workspace that inherited it.
export async function revokeTool(scope: ScopeId, name: string): Promise<void> {
  await Deno.remove(livePath(scope, name));
}
