// Where pique and pi keep things on disk. Runs Deno-side only.
//
// pi's agent dir is the one the `pi` CLI uses, so the two share everything in it:
//
//   extensions/        local extensions, and user modules beside them (modules/)
//   prompts/           prompt templates
//   skills/            skills
//   settings.json      installed packages
//   SYSTEM.md          replaces pi's own preamble, when present
//   APPEND_SYSTEM.md   added on top of whichever base prompt applies
//   auth.json, models.json   provider credentials and custom endpoints
//
// pi discovers all of it itself, so pique only ever reads and writes these files — it
// does not assemble anything pi would not find on its own. pique's own state (layout,
// prefs, chat defaults, conversations, module storage) stays under ~/.pique.
import { home } from "./home.ts";

export function agentDir(): string {
  return `${home()}/.pi/agent`;
}

export function piqueDir(): string {
  return `${home()}/.pique`;
}

// Workspace and view ids name directories, so constrain them: no separators, no
// traversal.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`invalid id: ${id}`);
}

// Where ONE view's chat conversations persist, as pi session JSONL. Each view runs its
// own conversation, and pi's continueRecent picks the newest session in a single flat
// directory — so separate threads mean separate directories, one per view. Kept out of
// the agent dir, where pi would also find them under its own default session path.
export function viewSessionsDir(workspace: string, view: string): string {
  assertId(workspace);
  assertId(view);
  return `${piqueDir()}/sessions/${workspace}/${view}`;
}
