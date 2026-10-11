// The merged extension surface: one list, two origins. Everything the Library and the
// extensions* win.bind handlers (src/desktop.ts) call lives here; local.ts and
// packages.ts hold the per-origin mechanics. Runs Deno-side only.
//
// An extension is listed iff it is in pi's OWN loading set — the extensions/ dir for a
// local module, settings.json for a package — so the list cannot disagree with what pi
// loads.
import { listLocal, readLocalSource, removeLocal } from "./local.ts";
import {
  type ExtSearchResult,
  installPackage,
  listPackages,
  type PackageType,
  removePackage,
  resolvePackageFiles,
  searchExtensions,
} from "./packages.ts";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../paths.ts";
import { home } from "../home.ts";

export { type ExtSearchResult, installPackage, type PackageType, searchExtensions };

export type Origin = "local" | "package";

export type Extension = {
  id: string;
  name: string;
  origin: Origin;
  source?: string;
  path?: string;
};

// What an expanded row shows for both origins: the files that execute, with their
// bytes. A local module is always one file; a package is however many entry files pi
// resolves. `skills` are listed by path only — they are not code, but they do reach the
// model.
export type ExtensionSource = {
  files: { path: string; text: string }[];
  skills: string[];
  truncated: boolean;
};

// A bundled npm entry file can be megabytes, and this crosses win.bind to land in a
// <pre>. Cap per file rather than refusing to show it; the UI says when it happened.
const MAX_SOURCE_BYTES = 200_000;

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

// Packages first, then local modules.
export async function listExtensions(): Promise<Extension[]> {
  const [local, packages] = await Promise.all([listLocal(), listPackages()]);
  return [
    ...packages.map((p): Extension => ({
      id: extensionId("package", p.source),
      name: p.source,
      origin: "package",
      source: p.source,
      path: p.path,
    })),
    ...local.map((l): Extension => ({
      id: extensionId("local", l.name),
      name: l.name,
      origin: "local",
    })),
  ];
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_SOURCE_BYTES) return { text, truncated: false };
  return { text: text.slice(0, MAX_SOURCE_BYTES), truncated: true };
}

// The bytes that run. For a package this resolves the entry files pi executes.
export async function readExtension(id: string): Promise<ExtensionSource> {
  const { origin, key } = parseId(id);
  let files: { path: string; text: string }[];
  let skills: string[] = [];
  if (origin === "local") {
    files = [{ path: `${key}.ts`, text: await readLocalSource(key) }];
  } else {
    const resolved = await resolvePackageFiles(key);
    skills = resolved.skills;
    files = [];
    for (const path of resolved.extensions) {
      // A resolved path can be missing if the bytes were removed behind our back; show
      // the gap rather than failing the whole read.
      const raw = await Deno.readTextFile(path).catch((e) =>
        `// unreadable: ${e.message}`
      );
      files.push({ path, text: raw });
    }
  }
  let truncated = false;
  const shown = files.map((f) => {
    const c = clamp(f.text);
    truncated ||= c.truncated;
    return { path: f.path, text: c.text };
  });
  return { files: shown, skills, truncated };
}

// Sessions already running keep it until they reload or restart.
export async function removeExtension(id: string): Promise<void> {
  const { origin, key } = parseId(id);
  if (origin === "local") return await removeLocal(key);
  return await removePackage(key);
}

// Which extensions pi could not actually load. One that fails to import is still in the
// loading set, so nothing in the list distinguishes it from one that works, and pi's own
// reload swallows the failure (chat/reload_resilience_test.ts probe B). Reading it back
// off a loader is the only way the Library can say so.
export async function extensionLoadErrors(): Promise<
  Array<{ name: string; error: string }>
> {
  const loader = new DefaultResourceLoader({ cwd: home(), agentDir: agentDir() });
  await loader.reload();
  const errors: Array<{ path: string; error: string }> =
    loader.getExtensions().errors ?? [];
  return errors.map((e) => ({
    name: e.path.split("/").pop()?.replace(/\.[jt]s$/, "") ?? e.path,
    error: e.error,
  }));
}
