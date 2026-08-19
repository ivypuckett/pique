// Backend JSON prefs storage under ~/.pique/ — mirrors .pi's settings.json
// convention: the desktop process owns these files and exposes them to the
// frontend over win.bind (see the config* handlers in src/desktop.ts). Runs
// Deno-side only. Each named config is one file: ~/.pique/<name>.json.
import { dirname } from "@std/path";
import { home } from "../home.ts";

// A parsed JSON value — the boundary type carried over win.bind (see desktop.ts).
export type Json = null | boolean | number | string | Json[] | {
  [k: string]: Json;
};

// Config names key a filename, so constrain them — no path separators / traversal.
const NAME_RE = /^[a-z][a-z0-9-]*$/;

function pathFor(name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`invalid config name: ${name}`);
  return `${home()}/.pique/${name}.json`;
}

// Missing or corrupt file → null so the caller falls back to defaults, matching
// how the layout store treats unparseable storage.
export async function readJson(name: string): Promise<Json> {
  try {
    return JSON.parse(await Deno.readTextFile(pathFor(name)));
  } catch {
    return null;
  }
}

export async function writeJson(name: string, data: unknown): Promise<void> {
  const path = pathFor(name);
  // Owner-only: these are one user's prefs, and nothing else on the host has any
  // business reading them. Deno's default would be 0755/0644.
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
}

// Expand a leading `~` (`~` or `~/...`) against the home directory; `~user` and
// non-leading `~` are left as-is. Blank input returns "". Resolved lazily so a path
// that needs no expansion is still usable where home() would throw.
function expandTilde(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed === "") return "";
  if (trimmed === "~") return home();
  if (trimmed.startsWith("~/")) return home() + trimmed.slice(1);
  return trimmed;
}

// Effective working directory for spawned shells and chat agents when a workspace
// has no override of its own: the ROOT workspace's cwd, else $HOME. This is what the
// old global workspace.defaultDir setting became — root's cwd is the value every
// other workspace falls back to. A leading `~` is expanded (`~` or `~/...`); `~user`
// and non-leading `~` are left as-is. `layout` is whatever readJson("layout")
// returned — possibly null, pre-root, or malformed — so every field is guarded.
export function resolveWorkspaceDir(layout: Json): string {
  if (layout && typeof layout === "object" && !Array.isArray(layout)) {
    const root = (layout as { [k: string]: Json }).root;
    if (root && typeof root === "object" && !Array.isArray(root)) {
      const dir = (root as { [k: string]: Json }).cwd;
      if (typeof dir === "string" && dir.trim() !== "") {
        return expandTilde(dir);
      }
    }
  }
  return home();
}

// How many directory levels to descend, when the workspace root is not itself a git
// repo, looking for the repos inside so their changed folders can be highlighted.
// Reads workspace.gitScanDepth, clamped to [0, 10] (0 = don't descend). Any missing,
// non-numeric, or out-of-range value falls back to the default of 3.
export function resolveGitScanDepth(settings: Json): number {
  const fallback = 3;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const ws = (settings as { [k: string]: Json }).workspace;
    if (ws && typeof ws === "object" && !Array.isArray(ws)) {
      const d = (ws as { [k: string]: Json }).gitScanDepth;
      if (typeof d === "number" && Number.isInteger(d) && d >= 0) {
        return Math.min(d, 10);
      }
    }
  }
  return fallback;
}

// Every scope that currently EXISTS, with its own cwd override — root first, then the
// numbered workspaces, in rail order. The layout is the session tree (session.ts's
// SessionState), so this reads the same `id`/`cwd` pair the module launchers already do.
//
// It is how the scheduler decides where to look for schedules (automatons/schedule.ts).
// The layout rather than the scopes directory on disk, deliberately: closing a workspace
// leaves ~/.pique/scopes/ws-N behind, and a schedule in a workspace the user has closed
// firing runs into a directory they think is gone is the wrong surprise.
export function layoutScopes(layout: Json): { id: string; cwd?: string }[] {
  const obj = (v: Json): { [k: string]: Json } | undefined =>
    v && typeof v === "object" && !Array.isArray(v)
      ? v as { [k: string]: Json }
      : undefined;
  const one = (v: Json): { id: string; cwd?: string } | undefined => {
    const w = obj(v);
    const id = w?.id;
    if (typeof id !== "string" || id === "") return undefined;
    return { id, cwd: typeof w?.cwd === "string" ? w.cwd : undefined };
  };
  const root = obj(layout)?.root;
  const rest = obj(layout)?.workspaces;
  return [
    ...(root === undefined ? [] : [one(root)]),
    ...(Array.isArray(rest) ? rest.map(one) : []),
  ].filter((w): w is { id: string; cwd?: string } => w !== undefined);
}

// Working directory for one spawned module: its own workspace's override when set
// (leading `~` expanded), else the root workspace's, else $HOME — the cwd half of
// the scope inheritance chain. The override is a raw string threaded down from the
// workspace state; a blank or absent one means "inherit".
export function resolveModuleDir(
  override: string | undefined,
  layout: Json,
): string {
  if (typeof override === "string" && override.trim() !== "") {
    return expandTilde(override);
  }
  return resolveWorkspaceDir(layout);
}
