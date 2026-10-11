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

// The "agent folder" setting (settings.agent.dir), `~` expanded, or undefined for the
// default. `settings` is whatever readJson("settings") returned, so every field is
// guarded.
export function resolveAgentDir(settings: Json): string | undefined {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const agent = (settings as { [k: string]: Json }).agent;
    if (agent && typeof agent === "object" && !Array.isArray(agent)) {
      const dir = (agent as { [k: string]: Json }).dir;
      if (typeof dir === "string") return expandTilde(dir) || undefined;
    }
  }
  return undefined;
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

// Working directory for one spawned module: its workspace's own directory when set
// (leading `~` expanded), else $HOME. The override is a raw string threaded down from the
// workspace state; a blank or absent one means "none set".
export function resolveModuleDir(override: string | undefined): string {
  const dir = typeof override === "string" ? expandTilde(override) : "";
  return dir === "" ? home() : dir;
}
