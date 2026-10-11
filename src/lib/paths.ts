// Where pique keeps things on disk. Runs Deno-side only.
//
// Everything lives under ~/.pique. pique's own state sits at the top of it (layout,
// prefs, conversations, module storage); pi's agent dir is a folder inside it, laid out
// exactly as pi lays out its own ~/.pi/agent:
//
//   extensions/        local extensions, and user modules beside them (modules/)
//   prompts/           prompt templates
//   skills/            skills
//   settings.json      installed packages, and the default model and thinking level
//   SYSTEM.md          replaces pi's own preamble, when present
//   APPEND_SYSTEM.md   added on top of whichever base prompt applies
//   auth.json, models.json   provider credentials and custom endpoints
//
// pi discovers all of it itself, so pique only ever reads and writes these files — it
// does not assemble anything pi would not find on its own. The agent dir can be moved
// (Settings → Library) — pointed at ~/.pi/agent, it is shared with the `pi` CLI.
import { home } from "./home.ts";

export function piqueDir(): string {
  return `${home()}/.pique`;
}

// The settings value, once configureAgentDir has run. Fixed for the life of the
// process: running conversations and the model runtime hold the dir they started with,
// so a change applies on the next launch.
let configured: string | undefined;

export function agentDir(): string {
  return configured ?? `${piqueDir()}/agent`;
}

// Called once at boot with the "agent folder" setting (blank for the default). It is
// also exported as PI_CODING_AGENT_DIR, so anything that asks pi where its dir is — an
// extension keeping its own files, say — gets the same answer pique does.
export function configureAgentDir(dir: string | undefined): void {
  configured = dir && dir.trim() !== "" ? dir.trim() : undefined;
  Deno.env.set("PI_CODING_AGENT_DIR", agentDir());
}

// Where the `pi` CLI keeps its setup by default — what "Import from pi" copies from.
export function piAgentDir(): string {
  return `${home()}/.pi/agent`;
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
