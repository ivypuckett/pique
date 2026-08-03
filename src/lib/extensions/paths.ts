// On-disk locations for a scope's extensions. Two sibling dirs inside its agent dir
// (scope/paths.ts), holding BOTH origins:
//
//   extensions/  LIVE local modules. pi auto-discovers `<agentDir>/extensions/*.ts`
//                and executes every module here at session start (agent.ts passes
//                agentDir).
//   pending/     QUARANTINE. Not an auto-discovered location, so nothing here ever
//                runs. Holds `<name>.ts` for a local module awaiting review, and
//                `<slug>.json` for a fetched-but-not-enabled package.
//
// The rule is one rule for both origins: an extension runs iff it is in pi's own
// loading set (this dir for local modules, settings.json for packages), and it is
// awaiting review iff there is a file for it in pending/. Neither half is a ledger
// that can drift — one is what pi reads, the other is a directory listing.
//
// Every path is keyed by scope: an extension enabled in ws-1 is ws-1's alone, while a
// local module enabled in root is inherited by every workspace (see local.ts
// inheritedExtensionFiles). Runs Deno-side only.
import { ensureScopeDirs, scopeAgentDir, type ScopeId } from "../scope/paths.ts";

// Local extension names become filenames, so constrain them so a name can never
// escape its dir (no separators / traversal), mirroring scope/paths.ts's ID_RE. The
// shape is also what pi wants of an LLM-callable tool name, since these modules exist
// to register one.
const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function liveDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/extensions`;
}

export function pendingDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/pending`;
}

export function assertExtensionName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid extension name: ${name}`);
}

export function livePath(scope: ScopeId, name: string): string {
  assertExtensionName(name);
  return `${liveDir(scope)}/${name}.ts`;
}

export function pendingPath(scope: ScopeId, name: string): string {
  assertExtensionName(name);
  return `${pendingDir(scope)}/${name}.ts`;
}

// A pending package's filename. Package sources are arbitrary strings ("npm:@scope/pkg",
// git URLs, absolute paths), so they are percent-encoded rather than validated: the
// encoding is reversible, which is what lets the pending dir stay a set of files whose
// presence is the record instead of a list-shaped ledger with entries that can disagree.
//
// encodeURIComponent leaves "." unescaped, so a slug can be "." or ".." — harmless,
// because it always gains a ".json" suffix and can never contain a separator. The
// assert states that invariant rather than trusting it.
export function packageSlug(source: string): string {
  const slug = encodeURIComponent(source);
  if (slug.includes("/") || slug.includes("\0")) {
    throw new Error(`unencodable package source: ${source}`);
  }
  return slug;
}

export function packageSource(slug: string): string {
  return decodeURIComponent(slug);
}

export function pendingPackagePath(scope: ScopeId, source: string): string {
  return `${pendingDir(scope)}/${packageSlug(source)}.json`;
}

// Ensure both dirs exist before writing into either.
export async function ensureExtensionDirs(scope: ScopeId): Promise<void> {
  await ensureScopeDirs(scope);
}
