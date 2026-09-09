// Reading a `<name>.module.json` into something the rest of the app can trust. Pure:
// the file's bytes come in, a definition or an error comes out, and nothing touches
// disk here.
//
// Returns a result rather than throwing, on purpose. A junk definition in one extension
// must not break the listing of every other one — the same shape a broken automaton
// gets, listed with its error rather than swallowing the list.
import { isAbsolute } from "@std/path";
import { MODULES } from "./manifest.ts";
import type { Capabilities, Manifest } from "./capabilities.ts";

// Same shape the extension listing already holds names to (extensions/paths.ts), and
// for the same reason: a name becomes a filename and must not escape its directory.
const NAME_RE = /^[a-z][a-z0-9_]*$/;

export type ParseResult =
  | { ok: true; def: Manifest }
  | { ok: false; error: string };

// Every capability there is. A name outside this set is an error rather than an ignored
// key: a typo that parsed as "grants nothing" would show as enabled in the consent
// screen and then fail at runtime with no explanation.
const BOOLEAN_CAPS = ["kanban", "storage", "agent"] as const;

function parseCapabilities(raw: unknown): Capabilities | string {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "capabilities must be an object";
  }
  const out: Capabilities = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if ((BOOLEAN_CAPS as readonly string[]).includes(key)) {
      if (typeof value !== "boolean") return `capability ${key} must be a boolean`;
      out[key as typeof BOOLEAN_CAPS[number]] = value;
      continue;
    }
    if (key === "fs") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "capability fs must be an object of read/write root lists";
      }
      const fs: { read?: string[]; write?: string[] } = {};
      for (const [side, roots] of Object.entries(value as Record<string, unknown>)) {
        if (side !== "read" && side !== "write") return `unknown fs grant: ${side}`;
        if (!Array.isArray(roots) || roots.some((r) => typeof r !== "string")) {
          return `fs.${side} must be a list of paths`;
        }
        // A relative root can never match: capabilities.ts refuses a path it cannot
        // anchor, so a definition carrying one would grant nothing while looking like
        // it granted something.
        const bad = (roots as string[]).find((r) => !isAbsolute(r));
        if (bad !== undefined) return `fs.${side} root must be absolute: ${bad}`;
        fs[side] = roots as string[];
      }
      out.fs = fs;
      continue;
    }
    return `unknown capability: ${key}`;
  }
  return out;
}

// `name` is the extension's own basename, taken from the filename on disk — never from
// inside the file. A definition therefore cannot claim to be a module other than the one
// it sits beside.
export function parseDefinition(name: string, text: string): ParseResult {
  if (!NAME_RE.test(name)) return { ok: false, error: `invalid module name: ${name}` };
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

  const capabilities = parseCapabilities(obj.capabilities);
  if (typeof capabilities === "string") return { ok: false, error: capabilities };

  return {
    ok: true,
    def: {
      kind: name,
      label: label.trim(),
      duplicable: obj.duplicable as boolean | undefined,
      capabilities,
    },
  };
}
