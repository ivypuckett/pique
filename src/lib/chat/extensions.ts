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

// A browse hit from the npm registry (pi.dev/packages is just an index over npm).
// `source` is install-ready ("npm:<name>") so it feeds the existing install path.
export type ExtSearchResult = {
  source: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  npm?: string;
};

// Light gate for the install input: accept the source forms pi understands
// (docs/packages.md) — npm:/git: specs, http(s)/ssh/git URLs, and local paths —
// and reject blank input. pi validates for real on install; this just stops the
// obviously-wrong (e.g. a bare package name) before we shell out.
export function isValidSource(source: string): boolean {
  const s = source.trim();
  if (s === "") return false;
  return /^(npm:|git:|https?:\/\/|ssh:\/\/|git@|\/|\.\/|\.\.\/)/.test(s);
}

// pi packages are published to npm tagged with the `pi-package` keyword. We query
// npm's public search API (documented, stable, ToS-clean — unlike scraping pi.dev)
// and constrain to that keyword, ANDed with the user's free-text query.
export function npmSearchUrl(query: string): string {
  const text = `keywords:pi-package ${query.trim()}`.trim();
  return `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=25`;
}

// deno-lint-ignore no-explicit-any
export function toSearchResult(obj: any): ExtSearchResult {
  const pkg = obj?.package ?? {};
  return {
    source: `npm:${pkg.name}`,
    name: String(pkg.name ?? ""),
    description: String(pkg.description ?? ""),
    author: String(pkg.publisher?.username ?? pkg.maintainers?.[0]?.username ?? ""),
    downloads: Number(obj?.downloads?.monthly ?? 0),
    npm: typeof pkg.links?.npm === "string" ? pkg.links.npm : undefined,
  };
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

// Browse pi packages via npm's public registry search. Networked; the caller
// (Settings UI) surfaces failures and falls back to the manual source input.
export async function searchExtensions(query: string): Promise<ExtSearchResult[]> {
  const res = await fetch(npmSearchUrl(query));
  if (!res.ok) throw new Error(`npm search failed: ${res.status}`);
  const data = await res.json();
  return (data?.objects ?? []).map(toSearchResult);
}
