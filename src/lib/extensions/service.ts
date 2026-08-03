// The merged extension surface: one list, one lifecycle, two origins. Everything the
// Settings UI and the extensions* win.bind handlers (src/desktop.ts) call lives here;
// local.ts and packages.ts hold the per-origin mechanics. Runs Deno-side only.
//
// The invariant this module exists to preserve: an extension is `enabled` iff it is in
// pi's OWN loading set for the scope — the extensions/ dir for a local module,
// settings.json for a package — and `pending` iff there is a file for it in pending/.
// There is no pique-side "approved" flag, so no record can disagree with what pi loads.
import {
  enableLocal,
  inheritedExtensionFiles,
  listLocal,
  listVisibleLocal,
  type LocalState,
  readLocalSource,
  removeLocal,
  revokeLocal,
} from "./local.ts";
import {
  enablePackage,
  type ExtSearchResult,
  fetchPackage,
  listEnabledPackages,
  listPendingPackages,
  removePackage,
  resolvePackageFiles,
  revokePackage,
  searchExtensions,
} from "./packages.ts";
import type { ScopeId } from "../scope/paths.ts";

export {
  type ExtSearchResult,
  fetchPackage,
  inheritedExtensionFiles,
  searchExtensions,
};

export type Origin = "local" | "package";
export type ExtState = LocalState;

export type Extension = {
  id: string;
  name: string;
  origin: Origin;
  state: ExtState;
  scope: ScopeId;
  source?: string;
  path?: string;
};

// One review payload for both origins: the files that would execute, with their bytes.
// A local module is always one file; a package is however many entry files pi resolves.
// `skills` are listed by path only — they are not code, but they do reach the model.
export type ExtensionSource = {
  files: { path: string; text: string }[];
  skills: string[];
  truncated: boolean;
};

// A bundled npm entry file can be megabytes, and this crosses win.bind to land in a
// <pre>. Cap per file rather than refusing to show it; the UI says when it happened.
const MAX_REVIEW_BYTES = 200_000;

// Ids are "<origin>:<rest>", split on the FIRST colon only — a package source is
// itself colon-bearing ("npm:pi-crew").
export function extensionId(origin: Origin, key: string): string {
  return `${origin}:${key}`;
}

export function parseId(id: string): { origin: Origin; key: string } {
  const i = id.indexOf(":");
  if (i === -1) throw new Error(`invalid extension id: ${id}`);
  const origin = id.slice(0, i);
  if (origin !== "local" && origin !== "package") {
    throw new Error(`invalid extension id: ${id}`);
  }
  return { origin, key: id.slice(i + 1) };
}

// One scope's own extensions, both origins, pending first — the review UI leads with
// what needs a decision.
export async function listExtensions(scope: ScopeId): Promise<Extension[]> {
  const [local, enabledPkgs, pendingPkgs] = await Promise.all([
    listLocal(scope),
    listEnabledPackages(scope),
    listPendingPackages(scope),
  ]);
  const out: Extension[] = [
    ...pendingPkgs.map((p): Extension => ({
      id: extensionId("package", p.source),
      name: p.source,
      origin: "package",
      state: "pending",
      scope,
      source: p.source,
      path: p.installedPath,
    })),
    ...enabledPkgs.map((p): Extension => ({
      id: extensionId("package", p.source),
      name: p.source,
      origin: "package",
      state: "enabled",
      scope,
      source: p.source,
      path: p.path,
    })),
    ...local.map((l): Extension => ({
      id: extensionId("local", l.name),
      name: l.name,
      origin: "local",
      state: l.state,
      scope,
    })),
  ];
  return out;
}

// What an agent in `scope` can reach: its own extensions, plus ancestors' enabled LOCAL
// ones. Packages are deliberately not inherited (packages.ts), so an ancestor's package
// never appears here — that asymmetry is real and the UI must show it as such.
export async function listVisibleExtensions(
  scope: ScopeId,
): Promise<Extension[]> {
  const inherited = (await listVisibleLocal(scope))
    .filter((l) => l.scope !== scope && l.state === "enabled")
    .map((l): Extension => ({
      id: extensionId("local", l.name),
      name: l.name,
      origin: "local",
      state: "enabled",
      scope: l.scope,
    }));
  return [...inherited, ...await listExtensions(scope)];
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_REVIEW_BYTES) return { text, truncated: false };
  return { text: text.slice(0, MAX_REVIEW_BYTES), truncated: true };
}

// The bytes a human reads before enabling. For a package this resolves the entry files
// pi would execute — which works on an unenabled source, and is what makes the gate the
// same gate for both origins rather than a source string for one of them.
export async function readExtension(
  scope: ScopeId,
  id: string,
  state: ExtState,
): Promise<ExtensionSource> {
  const { origin, key } = parseId(id);
  if (origin === "local") {
    const { text, truncated } = clamp(await readLocalSource(scope, key, state));
    return { files: [{ path: `${key}.ts`, text }], skills: [], truncated };
  }
  const { extensions, skills } = await resolvePackageFiles(scope, key);
  const files: { path: string; text: string }[] = [];
  let truncated = false;
  for (const path of extensions) {
    // A resolved path can be missing if the bytes were removed behind our back; show
    // the gap rather than failing the whole review.
    const raw = await Deno.readTextFile(path).catch((e) =>
      `// unreadable: ${e.message}`
    );
    const c = clamp(raw);
    truncated ||= c.truncated;
    files.push({ path, text: c.text });
  }
  return { files, skills, truncated };
}

export async function enableExtension(
  scope: ScopeId,
  id: string,
): Promise<void> {
  const { origin, key } = parseId(id);
  if (origin === "local") return await enableLocal(scope, key);
  return await enablePackage(scope, key);
}

// Stops it running at the next session start, keeps the bytes, and sends it back
// through review. Sessions already running keep it until they restart.
export async function revokeExtension(
  scope: ScopeId,
  id: string,
): Promise<void> {
  const { origin, key } = parseId(id);
  if (origin === "local") return await revokeLocal(scope, key);
  return await revokePackage(scope, key);
}

export async function removeExtension(
  scope: ScopeId,
  id: string,
  state: ExtState,
): Promise<void> {
  const { origin, key } = parseId(id);
  if (origin === "local") return await removeLocal(scope, key, state);
  return await removePackage(scope, key);
}
