// Backend service for defined tools: lists the two dirs, reads a tool's source for
// human review, and moves files between quarantine and live. The tools* win.bind
// handlers (desktop.ts) are the human half; agent-tools.ts is the agent half and
// can only ever write into pending. Runs Deno-side only.
import { ensureToolDirs, liveDir, livePath, pendingDir, pendingPath } from "./paths.ts";

export type ToolState = "pending" | "approved";
export type DefinedTool = { name: string; state: ToolState };

// Tool names are the `*.ts` basenames in a dir. A missing dir means "none yet"
// (nothing has been defined on this install), not an error.
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

// Both lists in one call — the review UI always shows them together.
export async function listTools(): Promise<DefinedTool[]> {
  const [pending, approved] = await Promise.all([namesIn(pendingDir()), namesIn(liveDir())]);
  return [
    ...pending.map((name): DefinedTool => ({ name, state: "pending" })),
    ...approved.map((name): DefinedTool => ({ name, state: "approved" })),
  ];
}

// The source a human reviews before approving — the exact bytes that will execute.
export async function readSource(name: string, state: ToolState): Promise<string> {
  return await Deno.readTextFile(state === "pending" ? pendingPath(name) : livePath(name));
}

// Approve = move quarantine → live. From here pi auto-discovers it at the next
// session start. Rename replaces any same-named live file, so re-approving a
// redefinition supersedes the old one rather than leaving both.
export async function approveTool(name: string): Promise<void> {
  await ensureToolDirs();
  await Deno.rename(pendingPath(name), livePath(name));
}

export async function rejectTool(name: string): Promise<void> {
  await Deno.remove(pendingPath(name));
}

// Revoke an already-approved tool: delete it outright. Sessions already running
// keep it until they restart (see docs/defined-tools.md, "Deferred").
export async function revokeTool(name: string): Promise<void> {
  await Deno.remove(livePath(name));
}
