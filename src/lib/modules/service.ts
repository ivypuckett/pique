// Which modules a scope has, read from disk. Runs Deno-side.
//
// A module is an extension that ships two siblings in the scope's LIVE extensions dir:
//
//   notes.module.json   its definition — label, duplicable, capabilities
//   notes.ui.html       the single document its frame runs
//
// Both must be present: a definition without a document has nothing to show, and a
// document without a definition has no label.
//
// A `.ts` is NOT required. A module that only draws a panel needs no pi extension at
// all, and requiring one would mean shipping a file whose only job is to exist — which
// on Deno 2.9.5 is also a way to panic the app at boot if it is malformed.
import { assertExtensionName, liveDir } from "../extensions/paths.ts";
import { scopeDir, type ScopeId, scopesDir } from "../scope/paths.ts";
import { type ModuleDefinition, parseDefinition } from "./definition.ts";

// A module plus the scope that owns it. The scope travels with the definition because
// the rail is per-window while modules are per-scope: a workspace showing a module that
// root owns must address root's copy, not look for one of its own.
export type InstalledModule = ModuleDefinition & { scope: ScopeId };

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

// Delete a module: its definition and its document. Either may already be gone — a
// half-installed module is listed with an error, and Delete is how it is cleared.
export async function removeModule(scope: ScopeId, name: string): Promise<void> {
  assertExtensionName(name);
  for (const ext of ["module.json", "ui.html"]) {
    try {
      await Deno.remove(`${liveDir(scope)}/${name}.${ext}`);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
}
