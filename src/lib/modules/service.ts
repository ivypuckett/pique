// Which modules a scope has, read from disk. Runs Deno-side.
//
// A module is an extension that ships two siblings in the scope's LIVE extensions dir:
//
//   notes.module.json   its definition — label, duplicable, capabilities
//   notes.ui.html       the single document its frame runs
//
// Both must be present: a definition without a document has nothing to show, and a
// document without a definition has no grants and no label. Neither is in pending/,
// which is the whole of the review gate here — the same rule extensions already follow
// (an extension runs iff it is in pi's own loading set), applied to modules.
//
// A `.ts` is NOT required. A module that only draws a panel needs no pi extension at
// all, and requiring one would mean shipping a file whose only job is to exist — which
// on Deno 2.9.5 is also a way to panic the app at boot if it is malformed.
import {
  ensureExtensionDirs,
  liveDir,
  pendingDir,
} from "../extensions/paths.ts";
import { scopeDir, type ScopeId, scopesDir } from "../scope/paths.ts";
import { parseDefinition } from "./definition.ts";
import type { Manifest } from "./capabilities.ts";

// A module plus the scope that owns it. The scope travels with the definition because
// the rail is per-window while modules are per-scope: a workspace showing a module that
// root owns must address root's copy, not look for one of its own.
export type InstalledModule = Manifest & { scope: ScopeId };

// Errors are returned beside the modules rather than thrown: one unreadable definition
// must not empty the list, and the Library needs the message to show on that row.
export type ModuleListing = {
  modules: InstalledModule[];
  errors: { scope: ScopeId; name: string; error: string }[];
};

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

// A module awaiting consent. Its definition is parsed so the consent screen can name
// the capabilities it asks for — reading them is the whole point of the gate — but it
// is not in the live dir, so nothing serves its document and the broker has no manifest
// for it. It cannot run.
export type PendingModule = {
  scope: ScopeId;
  name: string;
  def?: Manifest;
  error?: string;
};

// The same rule extensions follow, applied to modules: a module RUNS iff its definition
// is in the live dir, and is AWAITING CONSENT iff there is one in pending/. Neither half
// is a flag that could disagree with what actually loads — one is what the server serves
// and the broker reads, the other is a directory listing.
export async function listPendingModules(
  scope: ScopeId,
): Promise<PendingModule[]> {
  const dir = pendingDir(scope);
  const out: PendingModule[] = [];
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".module.json")) {
        names.push(entry.name.slice(0, -".module.json".length));
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  for (const name of names.sort()) {
    try {
      const parsed = parseDefinition(
        name,
        await Deno.readTextFile(`${dir}/${name}.module.json`),
      );
      if (parsed.ok) out.push({ scope, name, def: parsed.def });
      else out.push({ scope, name, error: parsed.error });
    } catch (err) {
      out.push({ scope, name, error: (err as Error).message });
    }
  }
  return out;
}

// Consent: move the definition AND its document into the live dir together. Both move
// or neither does — a definition without its document is a rail row that opens nothing,
// and a document without its definition has no grants at all.
export async function enableModule(
  scope: ScopeId,
  name: string,
): Promise<void> {
  const parsed = parseDefinition(
    name,
    await Deno.readTextFile(`${pendingDir(scope)}/${name}.module.json`),
  );
  // Re-read and re-validate at the moment of consent rather than trusting what the
  // listing showed: a Library tab left open all day is a window in which the file can
  // change between the reading and the pressing.
  if (!parsed.ok) throw new Error(parsed.error);
  await ensureExtensionDirs(scope);
  await Deno.rename(
    `${pendingDir(scope)}/${name}.ui.html`,
    `${liveDir(scope)}/${name}.ui.html`,
  );
  await Deno.rename(
    `${pendingDir(scope)}/${name}.module.json`,
    `${liveDir(scope)}/${name}.module.json`,
  );
}

// Revoke returns a module to the gate rather than deleting it, so re-enabling means
// consenting to its capabilities again — which is what makes a changed capability list
// impossible to slip past a user who once said yes.
export async function revokeModule(
  scope: ScopeId,
  name: string,
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.rename(
    `${liveDir(scope)}/${name}.module.json`,
    `${pendingDir(scope)}/${name}.module.json`,
  );
  await Deno.rename(
    `${liveDir(scope)}/${name}.ui.html`,
    `${pendingDir(scope)}/${name}.ui.html`,
  );
}

// One scope's own modules. Nothing inherited — the caller composes scopes, because the
// rail wants every scope's modules at once while a capability check wants exactly one.
export async function listModules(scope: ScopeId): Promise<ModuleListing> {
  const dir = liveDir(scope);
  const modules: InstalledModule[] = [];
  const errors: ModuleListing["errors"] = [];

  let names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".module.json")) {
        names.push(entry.name.slice(0, -".module.json".length));
      }
    }
  } catch (err) {
    // A scope that has never had an extension has no dir. That is "none", not a fault.
    if (err instanceof Deno.errors.NotFound) return { modules: [], errors: [] };
    throw err;
  }
  names = names.sort();

  for (const name of names) {
    let text: string;
    try {
      text = await Deno.readTextFile(`${dir}/${name}.module.json`);
    } catch (err) {
      errors.push({ scope, name, error: (err as Error).message });
      continue;
    }
    const parsed = parseDefinition(name, text);
    if (!parsed.ok) {
      errors.push({ scope, name, error: parsed.error });
      continue;
    }
    if (!await fileExists(`${dir}/${name}.ui.html`)) {
      errors.push({ scope, name, error: `${name}.ui.html is missing` });
      continue;
    }
    modules.push({ ...parsed.def, scope });
  }
  return { modules, errors };
}

// Every scope's modules, for the window's module table. Scopes are read from disk
// rather than from the layout: a workspace that exists on disk but is not currently
// open still owns its modules, and this list is rebuilt on every refresh anyway.
export async function listAllModules(): Promise<InstalledModule[]> {
  const out: InstalledModule[] = [];
  let ids: string[] = [];
  try {
    for await (const entry of Deno.readDir(scopesDir())) {
      if (entry.isDirectory) ids.push(entry.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  // root first, so a workspace module never sorts ahead of the one it may shadow.
  ids = ids.sort((
    a,
    b,
  ) => (a === "root" ? -1 : b === "root" ? 1 : a.localeCompare(b)));
  for (const id of ids) {
    // A directory under scopes/ that is not a legal scope id is not ours to read.
    try {
      scopeDir(id);
    } catch {
      continue;
    }
    const { modules } = await listModules(id);
    out.push(...modules);
  }
  return out;
}

// The manifest the broker checks a call against. Resolved for the module the HOST named,
// in the scope the host named — never from anything the frame said.
export async function manifestFor(
  scope: ScopeId,
  moduleId: string,
): Promise<Manifest | undefined> {
  const { modules } = await listModules(scope);
  return modules.find((m) => m.kind === moduleId);
}
