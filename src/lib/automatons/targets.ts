// Where an unattended run works, read from the saved layout. Shared by both triggers —
// the cron clock (schedule.ts) walks every target each minute, the kanban dispatcher
// (kanban.ts) asks about the one scope whose board fired — so the resolution lives in
// neither of them.
//
// The layout, not the directories under ~/.pique/scopes/: closing a workspace leaves its
// directory behind, and firing runs into a workspace the user thinks is gone is the wrong
// surprise. Deno-side only.
import { layoutScopes, readJson, resolveModuleDir } from "../settings/file.ts";
import type { ScopeId } from "../scope/paths.ts";

// A scope a trigger may fire in, and the directory its runs would work in.
export type Target = { scope: ScopeId; cwd: string };

export async function scheduledTargets(): Promise<Target[]> {
  const layout = await readJson("layout");
  return layoutScopes(layout).map((w) => ({
    scope: w.id,
    // The same resolution a module gets: the workspace's own override, else root's, else
    // $HOME. A triggered run must work where a launched one would.
    cwd: resolveModuleDir(w.cwd, layout),
  }));
}

// One scope's working directory, or undefined when the layout has no such scope — a
// closed workspace whose board file is still on disk. A trigger with no cwd does not
// fire; see schedule.ts decision 4 for why that is the same rule for both triggers.
export async function scopeCwd(scope: ScopeId): Promise<string | undefined> {
  return (await scheduledTargets()).find((t) => t.scope === scope)?.cwd;
}
