// Package extensions: third-party pi packages (npm/git/local path), managed through
// pi's own DefaultPackageManager. Runs in the desktop process only.
//
// Packages install into ONE SCOPE's pi config dir (~/.pique/scopes/<id>/agent),
// SEPARATE from the user's `pi` CLI (~/.pi/agent) — installing here never touches
// their pi setup. Only extensions/packages/pi-settings are separated; credentials and
// models.json stay shared with pi via ModelRuntime.create() (see chat/agent.ts).
//
// The lifecycle mirrors local.ts, using the split pi already provides (verified
// 2026-08-03 against pi-coding-agent 0.80.10):
//
//   fetch    install(source)               downloads; does NOT register it
//   pending  pending/<slug>.json           our record that bytes exist, unenabled
//   review   resolveExtensionSources(...)  the exact entry files that would run
//   enable   addSourceToSettings(source)   settings.json is pi's own loading set
//   revoke   removeSourceFromSettings(..)  files stay; back to pending
//   delete   remove(source)                bytes go
//
// Unlike local extensions, packages are NOT inherited from root: pulling root's
// packages down additionalExtensionPaths is untested here. It was also the operation
// implicated in the old boot panic, but that was an upstream deno_core bug fixed in
// Deno 2.9.4 (docs/extensions.md Known broken #5) — see docs/scopes.md Deferred #1.

import { resolve } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { readJson, resolveWorkspaceDir } from "../settings/file.ts";
import {
  ensureScopeDirs,
  scopeAgentDir,
  type ScopeId,
} from "../scope/paths.ts";
import {
  ensureExtensionDirs,
  packageSource,
  pendingDir,
  pendingPackagePath,
} from "./paths.ts";

// JSON-safe projection of pi's ConfiguredPackage that crosses the win.bind boundary.
export type ExtInfo = { source: string; scope: string; path?: string };

// Our record of a fetched-but-not-enabled package. `source` is authoritative — the
// filename is only its encoding — because pi rewrites some sources on the way into
// settings.json (a local path becomes relative to agentDir), so the string we install
// with is not always the string we read back.
export type PendingPackage = {
  source: string;
  installedPath?: string;
  requestedAt: string;
};

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
  return `https://registry.npmjs.org/-/v1/search?text=${
    encodeURIComponent(text)
  }&size=25`;
}

// deno-lint-ignore no-explicit-any
export function toSearchResult(obj: any): ExtSearchResult {
  const pkg = obj?.package ?? {};
  return {
    source: `npm:${pkg.name}`,
    name: String(pkg.name ?? ""),
    description: String(pkg.description ?? ""),
    author: String(
      pkg.publisher?.username ?? pkg.maintainers?.[0]?.username ?? "",
    ),
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

// One package manager per scope, cached — each writes to its own scope's
// settings.json, so they must not be shared. Keyed by the resolved agentDir rather
// than the scope id, because the dir embeds $HOME: keying by id alone would hand back
// a manager pointing at a stale tree whenever HOME changes under us (which is exactly
// what the tests do).
// deno-lint-ignore no-explicit-any
const managers = new Map<string, any>();
async function manager(scope: ScopeId) {
  const agentDir = scopeAgentDir(scope);
  let pm = managers.get(agentDir);
  if (!pm) {
    await ensureScopeDirs(scope);
    const cwd = resolveWorkspaceDir(await readJson("settings"));
    const settingsManager = SettingsManager.create(cwd, agentDir);
    pm = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    managers.set(agentDir, pm);
  }
  return pm;
}

// Whether a source is a local path rather than an npm/git spec, by the same rule pi's
// own parseSource uses: anything that is not one of the known prefixes.
function isLocalSource(source: string): boolean {
  return !/^(npm:|git:|https?:\/\/|ssh:\/\/|git@)/.test(source);
}

// pi stores a local-path source RELATIVE TO agentDir but resolves a *supplied* one
// against cwd (verified 2026-08-03: getSourceMatchKeyForSettings uses
// getBaseDirForScope("user") === agentDir, getSourceMatchKeyForInput uses resolvePath,
// which is cwd-based). Handing the stored form straight back therefore matches nothing,
// and removeSourceFromSettings quietly returns false — a revoke that reports success
// and changes nothing. Canonicalizing to an absolute path makes both sides agree, so
// every source that leaves this module is one pi will match on the way back in.
function canonical(source: string, agentDir: string): string {
  return isLocalSource(source) ? resolve(agentDir, source) : source;
}

// Enabled = present in the scope's settings.json, which is pi's own record of what it
// loads. Nothing here is a pique-side flag.
export async function listEnabledPackages(scope: ScopeId): Promise<ExtInfo[]> {
  const agentDir = scopeAgentDir(scope);
  return (await manager(scope)).listConfiguredPackages().map(toExtInfo).map((
    e: ExtInfo,
  ): ExtInfo => ({ ...e, source: canonical(e.source, agentDir) }));
}

// Pending = a `<slug>.json` in the scope's pending dir. A missing dir means none yet.
// A file that does not parse is skipped rather than raising: the dir is user-visible,
// and one bad file must not blank the whole list.
export async function listPendingPackages(
  scope: ScopeId,
): Promise<PendingPackage[]> {
  const out: PendingPackage[] = [];
  try {
    for await (const entry of Deno.readDir(pendingDir(scope))) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
        const rec = JSON.parse(
          await Deno.readTextFile(`${pendingDir(scope)}/${entry.name}`),
        );
        out.push({
          // Fall back to the filename's own encoding if the record lost its source.
          source: typeof rec?.source === "string"
            ? rec.source
            : packageSource(entry.name.slice(0, -5)),
          installedPath: typeof rec?.installedPath === "string"
            ? rec.installedPath
            : undefined,
          requestedAt: typeof rec?.requestedAt === "string"
            ? rec.requestedAt
            : "",
        });
      } catch {
        continue;
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

// Fetch the bytes and quarantine them. install() downloads without registering the
// source, so this deliberately does NOT reach the loading set — review happens against
// code on disk rather than against a string the user typed.
export async function fetchPackage(
  scope: ScopeId,
  source: string,
): Promise<void> {
  const s = source.trim();
  if (!isValidSource(s)) throw new Error(`invalid extension source: ${source}`);
  const pm = await manager(scope);
  await pm.install(s);
  await ensureExtensionDirs(scope);
  const rec: PendingPackage = {
    source: s,
    installedPath: pm.getInstalledPath(s, "user"),
    requestedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(
    pendingPackagePath(scope, s),
    JSON.stringify(rec, null, 2),
  );
}

// The files pi would execute for this source — what the reviewer actually reads.
// Works on an unenabled package, which is what makes the gate real rather than
// cosmetic. Skills/prompts/themes are returned too: they are not code, but they do
// reach the model, so the reviewer should see that they exist.
export async function resolvePackageFiles(
  scope: ScopeId,
  source: string,
): Promise<{ extensions: string[]; skills: string[] }> {
  const resolved = await (await manager(scope)).resolveExtensionSources([
    source,
  ]);
  // deno-lint-ignore no-explicit-any
  const paths = (list: any[]) => list.map((r) => String(r.path));
  return {
    extensions: paths(resolved.extensions ?? []),
    skills: paths(resolved.skills ?? []),
  };
}

// Enable = add to settings.json, then drop the quarantine record. The pending file is
// removed by the slug of the source WE hold, never by matching what came back from
// settings — pi normalizes some sources on the way in, so a match could miss.
export async function enablePackage(
  scope: ScopeId,
  source: string,
): Promise<void> {
  const pm = await manager(scope);
  pm.addSourceToSettings(source);
  await Deno.remove(pendingPackagePath(scope, source)).catch(() => {});
}

// Revoke = drop from settings.json and return to quarantine. The bytes stay, so
// re-enabling is a re-review rather than a re-download — the same trip revokeLocal
// makes. The source recorded is the one settings held, which for a local path is pi's
// normalized form ("../pkg", relative to agentDir). Verified 2026-08-03 that the
// normalized form round-trips: removeSourceFromSettings, resolveExtensionSources and
// addSourceToSettings all accept it, so a revoked package re-enables cleanly.
export async function revokePackage(
  scope: ScopeId,
  source: string,
): Promise<void> {
  const pm = await manager(scope);
  const installedPath = pm.getInstalledPath(source, "user");
  pm.removeSourceFromSettings(source);
  await ensureExtensionDirs(scope);
  const rec: PendingPackage = {
    source,
    installedPath,
    requestedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(
    pendingPackagePath(scope, source),
    JSON.stringify(rec, null, 2),
  );
}

// Delete the bytes and every record of the package, from whichever state it is in.
export async function removePackage(
  scope: ScopeId,
  source: string,
): Promise<void> {
  const pm = await manager(scope);
  pm.removeSourceFromSettings(source);
  await pm.remove(source);
  await Deno.remove(pendingPackagePath(scope, source)).catch(() => {});
}

// Browse pi packages via npm's public registry search. Networked; the caller
// (the Library module) surfaces failures and falls back to the manual source input.
export async function searchExtensions(
  query: string,
): Promise<ExtSearchResult[]> {
  const res = await fetch(npmSearchUrl(query));
  if (!res.ok) throw new Error(`npm search failed: ${res.status}`);
  const data = await res.json();
  return (data?.objects ?? []).map(toSearchResult);
}
