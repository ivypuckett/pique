// Which modules are installed, read from disk. Runs Deno-side.
//
// A module is an extension that ships two siblings in pi's extensions dir:
//
//   notes.module.json   its definition — label, duplicable
//   notes.ui.html       the single document its frame runs
//
// Both must be present: a definition without a document has nothing to show, and a
// document without a definition has no label.
//
// A `.ts` is NOT required. A module that only draws a panel needs no pi extension at
// all, and requiring one would mean shipping a file whose only job is to exist — which
// on Deno 2.9.5 is also a way to panic the app at boot if it is malformed.
import { assertExtensionName, liveDir } from "../extensions/paths.ts";
import { type ModuleDefinition, parseDefinition } from "./definition.ts";

export type InstalledModule = ModuleDefinition;

// Errors are returned beside the modules rather than thrown: one unreadable definition
// must not empty the list.
export type ModuleListing = {
  modules: InstalledModule[];
  errors: { name: string; error: string }[];
};

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

export async function listModules(): Promise<ModuleListing> {
  const dir = liveDir();
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
    // No extensions dir yet is "none", not a fault.
    if (err instanceof Deno.errors.NotFound) return { modules: [], errors: [] };
    throw err;
  }
  names = names.sort();

  for (const name of names) {
    let text: string;
    try {
      text = await Deno.readTextFile(`${dir}/${name}.module.json`);
    } catch (err) {
      errors.push({ name, error: (err as Error).message });
      continue;
    }
    const parsed = parseDefinition(name, text);
    if (!parsed.ok) {
      errors.push({ name, error: parsed.error });
      continue;
    }
    if (!await fileExists(`${dir}/${name}.ui.html`)) {
      errors.push({ name, error: `${name}.ui.html is missing` });
      continue;
    }
    modules.push(parsed.def);
  }
  return { modules, errors };
}

// Delete a module: its definition and its document. Either may already be gone — a
// half-installed module is listed with an error, and Delete is how it is cleared.
export async function removeModule(name: string): Promise<void> {
  assertExtensionName(name);
  for (const ext of ["module.json", "ui.html"]) {
    try {
      await Deno.remove(`${liveDir()}/${name}.${ext}`);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
}
