// On-disk location of per-workspace Kanban boards. One SQLite DB per workspace,
// keyed by the workspace id from layout.json, under ~/.pique/boards/. Mirrors the
// HOME-based resolution in settings/file.ts. Runs Deno-side only.

// Workspace ids are the layout's "ws-N" slugs; constrain them so an id can never
// escape the boards dir (no separators / traversal), matching file.ts's NAME_RE.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function home(): string {
  const h = Deno.env.get("HOME");
  if (!h) throw new Error("HOME is not set");
  return h;
}

export function boardsDir(): string {
  return `${home()}/.pique/boards`;
}

export function boardPath(workspaceId: string): string {
  if (!ID_RE.test(workspaceId)) throw new Error(`invalid workspace id: ${workspaceId}`);
  return `${boardsDir()}/${workspaceId}.db`;
}

// Ensure ~/.pique/boards exists before opening a DB file inside it.
export async function ensureBoardsDir(): Promise<void> {
  await Deno.mkdir(boardsDir(), { recursive: true });
}
