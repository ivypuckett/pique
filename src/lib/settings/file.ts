// Backend JSON prefs storage under ~/.pique/ — mirrors .pi's settings.json
// convention: the desktop process owns these files and exposes them to the
// frontend over win.bind (see the config* handlers in src/desktop.ts). Runs
// Deno-side only. Each named config is one file: ~/.pique/<name>.json.

// A parsed JSON value — the boundary type carried over win.bind (see desktop.ts).
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// Config names key a filename, so constrain them — no path separators / traversal.
const NAME_RE = /^[a-z][a-z0-9-]*$/;

function pathFor(name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`invalid config name: ${name}`);
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set");
  return `${home}/.pique/${name}.json`;
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
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n");
}

// pique's own pi config dir. Extensions, installed pi packages, and their
// settings.json live here — SEPARATE from the user's `pi` CLI at ~/.pi/agent, so
// installing an extension in pique never touches their pi setup. Credentials and
// models.json still come from ~/.pi/agent via ModelRuntime (see chat/agent.ts), so
// only extensions are separated. Passed as `agentDir` to createAgentSession and to
// the package manager (see chat/extensions.ts).
export function piAgentDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set");
  return `${home}/.pique/agent`;
}

// Expand a leading `~` (`~` or `~/...`) against $HOME; `~user` and non-leading `~`
// are left as-is. Blank input returns "".
function expandTilde(dir: string, home: string): string {
  const trimmed = dir.trim();
  if (trimmed === "") return "";
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return home + trimmed.slice(1);
  return trimmed;
}

// Effective working directory for spawned shells and chat agents: the persisted
// workspace.defaultDir when it is a non-empty string, else $HOME. A leading `~`
// is expanded (`~` or `~/...`); `~user` and non-leading `~` are left as-is.
// `settings` is whatever readJson("settings") returned — possibly null, missing
// the section, or holding a non-string — so every field is guarded (mirrors
// resolveChatDefaults).
export function resolveWorkspaceDir(settings: Json): string {
  const home = Deno.env.get("HOME") ?? "/";
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const ws = (settings as { [k: string]: Json }).workspace;
    if (ws && typeof ws === "object" && !Array.isArray(ws)) {
      const dir = (ws as { [k: string]: Json }).defaultDir;
      if (typeof dir === "string" && dir.trim() !== "") {
        return expandTilde(dir, home);
      }
    }
  }
  return home;
}

// Working directory for one spawned module: its per-workspace override when set
// (leading `~` expanded), else the global default from resolveWorkspaceDir. The
// override is a raw string threaded down from the workspace state; a blank or
// absent one means "use the default", so existing behavior is unchanged.
export function resolveModuleDir(override: string | undefined, settings: Json): string {
  if (typeof override === "string" && override.trim() !== "") {
    return expandTilde(override, Deno.env.get("HOME") ?? "/");
  }
  return resolveWorkspaceDir(settings);
}
