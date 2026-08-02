// On-disk locations for a scope, and the inheritance chain between scopes.
//
// A scope is the root workspace ("root") or one numbered workspace ("ws-N"). Each
// owns a directory under ~/.pique/scopes/<id>:
//
//   config.json   scoped prefs (chat defaults, kanban statuses)
//   agent/        this scope's pi agentDir — extensions/, pending/, settings.json
//   sessions/     this scope's saved chat conversations, as pi session JSONL
//   board.db      this scope's Kanban board
//
// Everything a scope inherits it inherits through `chain`, which is the ONLY place
// the shape of the hierarchy is encoded — widen it there if scopes ever nest deeper
// than root → workspace. Runs Deno-side only.

// Scope ids key a directory name, so constrain them the way kanban/paths.ts did the
// board filename: no separators, no traversal.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export type ScopeId = string;

// The one scope every other scope inherits from, and the only one that inherits
// from nothing.
export const ROOT: ScopeId = "root";

export function assertScopeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`invalid scope id: ${id}`);
}

// Scopes an agent in `id` resolves against, furthest ancestor FIRST so a later
// entry overrides an earlier one. Root resolves against itself alone — a workspace
// can see root, root can never see a workspace.
export function chain(id: ScopeId): ScopeId[] {
  assertScopeId(id);
  return id === ROOT ? [ROOT] : [ROOT, id];
}

function home(): string {
  const h = Deno.env.get("HOME");
  if (!h) throw new Error("HOME is not set");
  return h;
}

export function scopesDir(): string {
  return `${home()}/.pique/scopes`;
}

export function scopeDir(id: ScopeId): string {
  assertScopeId(id);
  return `${scopesDir()}/${id}`;
}

// This scope's pi agentDir, passed to createAgentSession. Holds extensions/ (which
// pi auto-discovers), pending/ (which it must not), and settings.json (packages).
export function scopeAgentDir(id: ScopeId): string {
  return `${scopeDir(id)}/agent`;
}

// Where this scope's chat conversations persist, as pi session JSONL. Kept out of
// agent/ because that dir is pi's agentDir and pi would then also find these under
// its own default session path; here they stay pique's, one thread per cwd per scope.
export function scopeSessionsDir(id: ScopeId): string {
  return `${scopeDir(id)}/sessions`;
}

export function scopeConfigPath(id: ScopeId): string {
  return `${scopeDir(id)}/config.json`;
}

export function scopeBoardPath(id: ScopeId): string {
  return `${scopeDir(id)}/board.db`;
}

// Create the scope's directory tree. Callers that write into a scope call this
// first; it is idempotent, so it doubles as "materialize a scope that has never
// been used" (every workspace gets one lazily, on first write).
export async function ensureScopeDirs(id: ScopeId): Promise<void> {
  await Deno.mkdir(`${scopeAgentDir(id)}/extensions`, { recursive: true });
  await Deno.mkdir(`${scopeAgentDir(id)}/pending`, { recursive: true });
}
