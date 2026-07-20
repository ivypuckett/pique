// Deno-side pi-extension (pi package) management. Runs in the desktop process only.
//
// Extensions install into pique's OWN pi config dir (piAgentDir = ~/.pique/agent),
// SEPARATE from the user's `pi` CLI (~/.pi/agent) — installing here never touches
// their pi setup. Only extensions/packages/pi-settings are separated; credentials
// and models.json stay shared with pi via ModelRuntime.create() (see agent.ts). For
// installed extensions to actually load, the chat agent is started with
// `agentDir: piAgentDir()` (see agent.ts:startAgent).
//
// The frontend half is the ext* win.bind handlers in src/desktop.ts; keep arg/return
// shapes in sync by hand (separate module graphs, as with the chat bindings).

import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { piAgentDir, readJson, resolveWorkspaceDir } from "../settings/file.ts";

// JSON-safe projection of pi's ConfiguredPackage that crosses the win.bind boundary.
export type ExtInfo = { source: string; scope: string; path?: string };

// Light gate for the install input: accept the source forms pi understands
// (docs/packages.md) — npm:/git: specs, http(s)/ssh/git URLs, and local paths —
// and reject blank input. pi validates for real on install; this just stops the
// obviously-wrong (e.g. a bare package name) before we shell out.
export function isValidSource(source: string): boolean {
  const s = source.trim();
  if (s === "") return false;
  return /^(npm:|git:|https?:\/\/|ssh:\/\/|git@|\/|\.\/|\.\.\/)/.test(s);
}

// deno-lint-ignore no-explicit-any
export function toExtInfo(pkg: any): ExtInfo {
  return {
    source: String(pkg.source),
    scope: String(pkg.scope),
    path: typeof pkg.installedPath === "string" ? pkg.installedPath : undefined,
  };
}

// deno-lint-ignore no-explicit-any
let pm: any | undefined;
async function manager() {
  if (!pm) {
    const cwd = resolveWorkspaceDir(await readJson("settings"));
    const agentDir = piAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir);
    pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  }
  return pm;
}

export async function listExtensions(): Promise<ExtInfo[]> {
  return (await manager()).listConfiguredPackages().map(toExtInfo);
}

// Fetch the package and persist it to pique's settings.json. Global (user) scope —
// project-local packages need project trust, which is out of scope.
export async function installExtension(source: string): Promise<void> {
  const s = source.trim();
  if (!isValidSource(s)) throw new Error(`invalid extension source: ${source}`);
  await (await manager()).installAndPersist(s);
}

export async function removeExtension(source: string): Promise<void> {
  await (await manager()).removeAndPersist(source);
}
