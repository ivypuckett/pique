// Package extensions: third-party pi packages (npm/git/local path), managed through
// pi's own DefaultPackageManager against the agent dir (paths.ts), laid out the way the
// `pi` CLI lays out its own. Runs in the desktop process only.
//
//   install  install(source) + addSourceToSettings(source)   downloads and enables
//   review   resolveExtensionSources(...)                     the entry files that run
//   delete   removeSourceFromSettings(source) + remove(source)

import { resolve } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { type PackageType, packageTypes, TYPE_KEYWORDS } from "./catalog.ts";
import { agentDir } from "../paths.ts";
import { home } from "../home.ts";

// JSON-safe projection of pi's ConfiguredPackage that crosses the win.bind boundary.
export type ExtInfo = { source: string; scope: string; path?: string };

export type { PackageType };

// A browse hit from the npm registry (pi.dev/packages is just an index over npm).
// `source` is install-ready ("npm:<name>") so it feeds the existing install path.
// `types` is what the package declares it carries — see catalog.ts.
export type ExtSearchResult = {
  source: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  npm?: string;
  types: PackageType[];
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
//
// `keyword`, when given, narrows further — npm's COMMA form is the one that ANDs here
// (`keywords:pi-package,theme` returns 85 of the 6,955 pi packages, every hit carrying
// both). The documented `+` form returns nothing, so do not reach for it.
export function npmSearchUrl(query: string, keyword?: string): string {
  const keywords = keyword
    ? `keywords:pi-package,${keyword}`
    : "keywords:pi-package";
  const text = `${keywords} ${query.trim()}`.trim();
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
    types: packageTypes(pkg.keywords),
  };
}

// Merge the per-keyword result sets of one type filter. Deduped by source, because a
// package keyworded both `skill` and `skills` comes back from two of the queries, and
// ordered by downloads: the per-query relevance ranks are not comparable across
// queries, so interleaving them would be arbitrary — popular-first is not.
export function mergeSearchResults(
  batches: ExtSearchResult[][],
): ExtSearchResult[] {
  const by = new Map<string, ExtSearchResult>();
  for (const batch of batches) {
    for (const r of batch) if (!by.has(r.source)) by.set(r.source, r);
  }
  return [...by.values()].sort((a, b) => b.downloads - a.downloads);
}

// deno-lint-ignore no-explicit-any
export function toExtInfo(pkg: any): ExtInfo {
  return {
    source: String(pkg.source),
    scope: String(pkg.scope),
    path: typeof pkg.installedPath === "string" ? pkg.installedPath : undefined,
  };
}

// The package manager, cached — but keyed by the resolved agent dir rather than held as
// one, because the dir embeds $HOME: a single cached manager would point at a stale tree
// whenever HOME changes under us (which is exactly what the tests do).
// deno-lint-ignore no-explicit-any
const managers = new Map<string, any>();
async function manager() {
  const dir = agentDir();
  let pm = managers.get(dir);
  if (!pm) {
    await Deno.mkdir(dir, { recursive: true });
    const cwd = home();
    const settingsManager = SettingsManager.create(cwd, dir);
    pm = new DefaultPackageManager({ cwd, agentDir: dir, settingsManager });
    managers.set(dir, pm);
  }
  return pm;
}

// Forget the cached manager, so the next call re-reads settings.json — after an import
// has rewritten it underneath the one held here.
export function resetPackageManager(): void {
  managers.clear();
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
// and removeSourceFromSettings quietly returns false — a delete that reports success
// and changes nothing. Canonicalizing to an absolute path makes both sides agree, so
// every source that leaves this module is one pi will match on the way back in.
function canonical(source: string, agentDir: string): string {
  return isLocalSource(source) ? resolve(agentDir, source) : source;
}

// Installed = present in settings.json, which is pi's own record of what it loads.
export async function listPackages(): Promise<ExtInfo[]> {
  const dir = agentDir();
  return (await manager()).listConfiguredPackages().map(toExtInfo).map((
    e: ExtInfo,
  ): ExtInfo => ({ ...e, source: canonical(e.source, dir) }));
}

// Download the package and add it to settings.json, so pi loads it at the next session
// start or `/reload`.
export async function installPackage(source: string): Promise<void> {
  const s = source.trim();
  if (!isValidSource(s)) throw new Error(`invalid extension source: ${source}`);
  const pm = await manager();
  await pm.install(s);
  pm.addSourceToSettings(s);
}

// The files pi executes for this source — what the Library shows when its row is
// expanded. Skills are returned too: they are not code, but they do reach the model.
export async function resolvePackageFiles(
  source: string,
): Promise<{ extensions: string[]; skills: string[] }> {
  const resolved = await (await manager()).resolveExtensionSources([
    source,
  ]);
  // deno-lint-ignore no-explicit-any
  const paths = (list: any[]) => list.map((r) => String(r.path));
  return {
    extensions: paths(resolved.extensions ?? []),
    skills: paths(resolved.skills ?? []),
  };
}

// Delete the bytes and pi's record of the package.
export async function removePackage(source: string): Promise<void> {
  const pm = await manager();
  pm.removeSourceFromSettings(source);
  await pm.remove(source);
}

async function searchOnce(
  query: string,
  keyword?: string,
): Promise<ExtSearchResult[]> {
  const res = await fetch(npmSearchUrl(query, keyword));
  if (!res.ok) throw new Error(`npm search failed: ${res.status}`);
  const data = await res.json();
  return (data?.objects ?? []).map(toSearchResult);
}

// Browse pi packages via npm's public registry search. Networked; the caller
// (the Library module) surfaces failures and falls back to the manual source input.
//
// A type filter costs one query per keyword in that type's table rather than one query
// filtered afterwards: only ~2% of the popular pi packages are themes, so filtering a
// single 25-hit page would usually show nothing at all.
export async function searchExtensions(
  query: string,
  type?: PackageType,
): Promise<ExtSearchResult[]> {
  if (!type) return await searchOnce(query);
  const settled = await Promise.allSettled(
    TYPE_KEYWORDS[type].map((k) => searchOnce(query, k)),
  );
  const ok = settled.filter((s) => s.status === "fulfilled").map((s) =>
    s.value
  );
  // npm rate-limits (429), and a fan-out is several requests at once. Losing one of
  // them costs a few hits at the margin; failing the whole search over it would cost
  // the user the ones that did come back. Only a total wipeout is an error.
  if (ok.length === 0) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  return mergeSearchResults(ok);
}

