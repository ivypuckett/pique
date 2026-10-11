// Reading a `<name>.module.json` into something the rest of the app can trust. Pure:
// the file's bytes come in, a definition or an error comes out, and nothing touches
// disk here.
//
// Returns a result rather than throwing, on purpose. A junk definition in one extension
// must not break the listing of every other one: it is listed with its error rather
// than swallowing the list.
import { MODULES } from "./manifest.ts";

// Same shape the extension listing already holds names to (extensions/paths.ts), and
// for the same reason: a name becomes a filename and must not escape its directory.
const NAME_RE = /^[a-z][a-z0-9_]*$/;

// What a module is: its kind (the filename), the title of its rail row and tab, and
// whether a view may hold more than one of it. Any other key in the file is ignored.
export type ModuleDefinition = {
  kind: string;
  label: string;
  duplicable?: boolean;
};

export type ParseResult =
  | { ok: true; def: ModuleDefinition }
  | { ok: false; error: string };

// `name` is the extension's own basename, taken from the filename on disk — never from
// inside the file. A definition therefore cannot claim to be a module other than the one
// it sits beside.
export function parseDefinition(name: string, text: string): ParseResult {
  if (!NAME_RE.test(name)) {
    return { ok: false, error: `invalid module name: ${name}` };
  }
  // A built-in always wins its kind. setInstalledModules filters this too, but refusing
  // it here means the collision is reported to whoever installed the module rather than
  // silently dropped.
  if (MODULES.some((m) => m.kind === name)) {
    return { ok: false, error: `${name} is a built-in module` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${(err as Error).message}` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "definition must be an object" };
  }
  const obj = raw as Record<string, unknown>;

  const label = obj.label;
  if (typeof label !== "string" || label.trim() === "") {
    return { ok: false, error: "label is required" };
  }
  if (obj.duplicable !== undefined && typeof obj.duplicable !== "boolean") {
    return { ok: false, error: "duplicable must be a boolean" };
  }

  return {
    ok: true,
    def: {
      kind: name,
      label: label.trim(),
      duplicable: obj.duplicable as boolean | undefined,
    },
  };
}
