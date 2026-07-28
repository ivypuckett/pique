// Scoped preferences: chat defaults and Kanban seed statuses, stored per scope at
// ~/.pique/scopes/<id>/config.json and resolved along the inheritance chain.
//
// A workspace's config is layered ON TOP of root's, key by key, so a workspace can
// pin one field (say a model) and keep inheriting the rest. Root resolves to just
// its own file. App-level prefs that aren't per-scope (theme, git scan depth) stay
// in ~/.pique/settings.json — see settings/file.ts. Runs Deno-side only.
import type { Json } from "../settings/file.ts";
import { chain, type ScopeId, scopeConfigPath, scopeDir } from "./paths.ts";

function isPlainObject(v: Json): v is { [k: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Layer `override` onto `base`. Plain objects merge key-by-key so a scope can set one
// field of a section without restating the others; arrays and scalars replace outright
// (a workspace's status list is its own list, not root's plus its own).
export function mergeConfig(base: Json, override: Json): Json {
  if (override === null || override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: { [k: string]: Json } = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? mergeConfig(out[k], v) : v;
  }
  return out;
}

// One scope's own config, with nothing inherited. Missing or corrupt file → null, so
// callers fall back to defaults (mirrors settings/file.ts readJson).
export async function readScopeConfig(id: ScopeId): Promise<Json> {
  try {
    return JSON.parse(await Deno.readTextFile(scopeConfigPath(id)));
  } catch {
    return null;
  }
}

export async function writeScopeConfig(id: ScopeId, data: unknown): Promise<void> {
  await Deno.mkdir(scopeDir(id), { recursive: true });
  await Deno.writeTextFile(scopeConfigPath(id), JSON.stringify(data, null, 2) + "\n");
}

// The config an agent or module in `id` actually sees: root's, overlaid with its own.
// This is what resolveChatDefaults and resolveKanbanDefaults are fed.
export async function resolveScopeConfig(id: ScopeId): Promise<Json> {
  let out: Json = null;
  for (const scope of chain(id)) out = mergeConfig(out, await readScopeConfig(scope));
  return out;
}
