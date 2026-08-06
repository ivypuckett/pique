// The merged extension surface: one list, one lifecycle, two origins. Everything the
// Library module and the extensions* win.bind handlers (src/desktop.ts) call lives
// here; local.ts and packages.ts hold the per-origin mechanics. Runs Deno-side only.
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
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import {
  chain,
  ensureScopeDirs,
  scopeAgentDir,
  type ScopeId,
} from "../scope/paths.ts";

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
  // What was on disk when this was read, over the FULL bytes rather than the clamped
  // `text` above — an enable that quoted the truncated display would be approving less
  // than it checked. Handed back to `enableExtension` so a file rewritten between
  // review and Enable cannot be enabled on the strength of the old reading.
  digest: string;
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

// What an agent in `scope` can reach: its own extensions, plus everything its ancestors
// have enabled — local modules and packages alike. Both origins inherit now; the list
// has to say so, because it is the only place a user can see why an agent has a tool
// that this scope never enabled.
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
  for (const ancestor of chain(scope).filter((s) => s !== scope)) {
    for (const pkg of await listEnabledPackages(ancestor)) {
      inherited.push({
        id: extensionId("package", pkg.source),
        name: pkg.source,
        origin: "package",
        state: "enabled",
        scope: ancestor,
        source: pkg.source,
        path: pkg.path,
      });
    }
  }
  return [...inherited, ...await listExtensions(scope)];
}

// Every extension file an agent in `scope` inherits from its ANCESTORS — the list that
// becomes `additionalExtensionPaths`. Two kinds, and they arrive by different routes: a
// local module is a path in the ancestor's extensions/ dir, while a package has to be
// resolved through the ancestor's package manager to the entry files pi would run. The
// option takes FILES, so handing it the package's directory would fail with "Cannot find
// module" and the package would silently never load.
//
// A source that will not resolve is skipped rather than thrown: it is usually bytes
// removed behind pi's back, and one broken package in root must not stop every workspace
// agent from starting. It still shows up in `extensionLoadErrors`, which loads the same
// set.
export async function inheritedExtensionPaths(
  scope: ScopeId,
): Promise<string[]> {
  const paths = await inheritedExtensionFiles(scope);
  for (const ancestor of chain(scope).filter((s) => s !== scope)) {
    for (const pkg of await listEnabledPackages(ancestor)) {
      try {
        const { extensions } = await resolvePackageFiles(ancestor, pkg.source);
        paths.push(...extensions);
      } catch {
        continue;
      }
    }
  }
  return paths;
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_REVIEW_BYTES) return { text, truncated: false };
  return { text: text.slice(0, MAX_REVIEW_BYTES), truncated: true };
}

// Everything that would actually run, unclamped: what the digest is taken over and what
// the review pane is then a truncated view of.
async function fullSource(
  scope: ScopeId,
  id: string,
  state: ExtState,
): Promise<{ files: { path: string; text: string }[]; skills: string[] }> {
  const { origin, key } = parseId(id);
  if (origin === "local") {
    return {
      files: [{
        path: `${key}.ts`,
        text: await readLocalSource(scope, key, state),
      }],
      skills: [],
    };
  }
  const { extensions, skills } = await resolvePackageFiles(scope, key);
  const files: { path: string; text: string }[] = [];
  for (const path of extensions) {
    // A resolved path can be missing if the bytes were removed behind our back; show
    // the gap rather than failing the whole review.
    const raw = await Deno.readTextFile(path).catch((e) =>
      `// unreadable: ${e.message}`
    );
    files.push({ path, text: raw });
  }
  return { files, skills };
}

// Paths as well as contents, so swapping which entry files a package resolves to counts
// as a change even when every individual file still reads the same. NUL separates the
// fields because it cannot occur in a path and will not occur in source — concatenating
// them plainly would let a file whose text ends in the next file's name collide.
async function digestOf(
  files: { path: string; text: string }[],
): Promise<string> {
  const joined = files.map((f) => `${f.path}\u0000${f.text}`).join(
    "\u0000\u0000",
  );
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(joined),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The bytes a human reads before enabling. For a package this resolves the entry files
// pi would execute — which works on an unenabled source, and is what makes the gate the
// same gate for both origins rather than a source string for one of them.
export async function readExtension(
  scope: ScopeId,
  id: string,
  state: ExtState,
): Promise<ExtensionSource> {
  const { files, skills } = await fullSource(scope, id, state);
  let truncated = false;
  const shown = files.map((f) => {
    const c = clamp(f.text);
    truncated ||= c.truncated;
    return { path: f.path, text: c.text };
  });
  return { files: shown, skills, truncated, digest: await digestOf(files) };
}

// `expectDigest` is the reading the human actually approved. A Library tab can sit open
// for hours between Review and Enable, and an agent with `write` can rewrite the file in
// that window — so the check is here rather than in the component, where it would be a
// courtesy rather than a gate.
export async function enableExtension(
  scope: ScopeId,
  id: string,
  expectDigest?: string,
): Promise<void> {
  const { origin, key } = parseId(id);
  if (expectDigest !== undefined) {
    const { files } = await fullSource(scope, id, "pending");
    if (await digestOf(files) !== expectDigest) {
      throw new Error(
        "This extension changed on disk after you reviewed it — read it again before enabling.",
      );
    }
  }
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

// Which enabled extensions pi could not actually load. An extension that fails to import
// is still `enabled` by this module's invariant — the file is in the loading set — so
// nothing in the list distinguishes it from one that works, and pi's own reload swallows
// the failure (chat/reload_resilience_test.ts probe B). Reading it back off the loader is
// the only way Library can say so.
//
// The loader is built the way chat/agent.ts builds one for a chat agent, minus the
// prompt layers, so the answer is about the set that scope's agents really load.
export async function extensionLoadErrors(
  scope: ScopeId,
): Promise<Array<{ name: string; error: string }>> {
  await ensureScopeDirs(scope);
  const loader = new DefaultResourceLoader({
    cwd: Deno.cwd(),
    agentDir: scopeAgentDir(scope),
    additionalExtensionPaths: await inheritedExtensionPaths(scope),
  });
  await loader.reload();
  const errors: Array<{ path: string; error: string }> =
    loader.getExtensions().errors ?? [];
  return errors.map((e) => ({
    name: e.path.split("/").pop()?.replace(/\.[jt]s$/, "") ?? e.path,
    error: e.error,
  }));
}
