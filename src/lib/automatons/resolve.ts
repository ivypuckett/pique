// An automaton's `extensions:` and `skills:` references → the concrete paths and tool
// groups a run is built from. This module is where "exactly what it names" is
// enforced: every ref must resolve, and an unresolvable one RAISES.
//
// Raising rather than skipping is deliberate and is the one behaviour that must not be
// softened. Profiles ignored unknown names silently, and their own design doc records
// how undebuggable that was; an automaton runs unattended, where a run that quietly
// does less than its file says is worse than one that does not start.
//
// Three ref shapes, checked in order:
//
//   pique:<group>   a compiled-in tool group (customTools, not a path)
//   <local name>    a `.ts` module in a scope's LIVE extensions dir, chain-resolved
//   anything else   a package source, which must already be enabled on the chain
//
// The last check is what stops an automaton from being a way around the review gate:
// pi would happily fetch and load `npm:anything` handed to additionalExtensionPaths.
// Chain-resolved like local modules, since packages inherit too (docs/extensions.md) —
// what the check enforces is that a HUMAN enabled it somewhere, not where.
// Runs Deno-side only.
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { kanbanTools } from "../kanban/agent-tools.ts";
import { extensionAuthoringTools } from "../extensions/agent-tools.ts";
import { promptAuthoringTools } from "../prompts/agent-tools.ts";
import { isValidSource, listEnabledPackages } from "../extensions/packages.ts";
import { livePath } from "../extensions/paths.ts";
import { resolveSkillPath } from "../skills/service.ts";
import { skillsDir } from "../skills/paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";
import { PI_BUILTIN_TOOLS } from "./builtins.ts";

export { PI_BUILTIN_TOOLS };

// pique's compiled-in tool groups, nameable exactly as extensions are. Every group is
// scope-bound: it acts on the scope the run belongs to.
export const BUILTIN_GROUPS: Record<
  string,
  (scope: ScopeId) => ToolDefinition[]
> = {
  "kanban": kanbanTools,
  "extension-authoring": extensionAuthoringTools,
  "prompt-authoring": promptAuthoringTools,
};

// An automaton's `tools:` → the builtins to EXCLUDE at session creation. Exclusion
// rather than pi's `allowedToolNames` on purpose: an allowlist filters extension tools
// and `pique:` groups too, so naming `tools: ["read"]` would silently strip everything
// `extensions:` had just resolved — the exact silent-underdelivery this module exists to
// prevent. Excluding the un-named builtins leaves the capability set alone.
//
// `undefined` means no restriction, which is every automaton written before the key
// existed. An empty list is a restriction: exclude all of them.
export function excludedBuiltins(tools: string[] | undefined): string[] {
  if (tools === undefined) return [];
  for (const name of tools) {
    if (!(PI_BUILTIN_TOOLS as readonly string[]).includes(name)) {
      throw new Error(
        `not a pi builtin: ${JSON.stringify(name)} (one of ${
          PI_BUILTIN_TOOLS.join(", ")
        }; extension tools belong in extensions:)`,
      );
    }
  }
  return PI_BUILTIN_TOOLS.filter((b) => !tools.includes(b));
}

// A local extension name — the shape extensions/paths.ts constrains filenames to. The
// `pique:` prefix cannot collide with one, because this admits no colon.
const LOCAL_NAME_RE = /^[a-z][a-z0-9_]*$/;

export type ResolvedRefs = {
  // For DefaultResourceLoader's additionalExtensionPaths: absolute file paths for
  // local modules, and source strings for packages. pi accepts both — every entry
  // goes through resolveExtensionSources, which treats it as a package source.
  extensionPaths: string[];
  // For createAgentSession's customTools.
  customTools: ToolDefinition[];
};

// The live path of a local extension, nearest scope first, or undefined. Only the
// LIVE dir is consulted: a pending or revoked module is not nameable, which is what
// keeps the review gate meaningful.
//
// Deno.stat follows symlinks, so a symlinked file in the live dir resolves here even
// though extensions/local.ts's namesIn (entry.isFile off Deno.readDir, which does not
// follow symlinks) would not list it — such an extension would be loadable by name but
// invisible in the review UI. Accepted: anyone who can write into the live dir already
// has code execution via pi's own discovery of that dir, so this widens no trust
// boundary; it is recorded here rather than changed.
async function resolveLocal(
  scope: ScopeId,
  name: string,
): Promise<string | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    const path = livePath(s, name);
    try {
      if ((await Deno.stat(path)).isFile) return path;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      // Anything else (e.g. a permission error) is a real failure, not "not found" —
      // reporting it as the latter would tell the user to enable something that is
      // already enabled. service.ts's read() and packages.ts draw the same line.
      throw err;
    }
  }
  return undefined;
}

export async function resolveExtensionRefs(
  scope: ScopeId,
  refs: string[],
): Promise<ResolvedRefs> {
  const extensionPaths: string[] = [];
  const customTools: ToolDefinition[] = [];
  // Fetched once rather than per ref: listing packages builds a pi package manager.
  let enabled: string[] | undefined;

  // Deduped, first-occurrence order kept: parse.ts does not dedupe upstream, and a
  // name repeated in the file is not a second reference — without this, repeating
  // "pique:kanban" registers its tools twice on the same session.
  for (const ref of new Set(refs)) {
    if (ref.startsWith("pique:")) {
      const name = ref.slice("pique:".length);
      // hasOwn, not a bare index: BUILTIN_GROUPS is a plain object, so an unguarded
      // lookup walks the prototype chain — "pique:toString" would silently resolve
      // to Object.prototype.toString, called with this === undefined, and its
      // one-character return value would spread into bogus "tools" rather than
      // raising. That is exactly the silent-underdelivery failure this module exists
      // to prevent.
      if (!Object.hasOwn(BUILTIN_GROUPS, name)) {
        throw new Error(
          `unknown built-in group: ${JSON.stringify(ref)} (known: ${
            Object.keys(BUILTIN_GROUPS).map((g) => `pique:${g}`).join(", ")
          })`,
        );
      }
      customTools.push(...BUILTIN_GROUPS[name](scope));
      continue;
    }

    if (LOCAL_NAME_RE.test(ref)) {
      const path = await resolveLocal(scope, ref);
      if (!path) {
        throw new Error(
          `extension not found or not enabled: ${
            JSON.stringify(ref)
          } (enable it in the Library module)`,
        );
      }
      extensionPaths.push(path);
      continue;
    }

    // Not a `pique:` group and not a legal local name (extensions/paths.ts's NAME_RE),
    // so this must be a package source to mean anything at all. Checked against
    // isValidSource's shape first so a plain typo — a hyphenated name is the natural
    // one, since hyphens are legal in skill and scope names but not extension names —
    // reports the right problem instead of "package not enabled", which points the
    // user at the Library module for something that could never appear there.
    if (!isValidSource(ref)) {
      throw new Error(
        `not a valid extension name or package source: ${JSON.stringify(ref)}`,
      );
    }

    // Packages canonicalize a local source to an absolute path (packages.ts), so only
    // that canonical form is ever nameable here — a relative source like "../../mypkg"
    // is rejected even when its absolute equivalent is enabled. Fails closed, not a
    // bug: it means an automaton file can't rely on a path that depends on where a
    // pique process happens to be running from.
    // Enabled anywhere on the chain, matching how a chat agent loads them and how
    // resolveLocal above already treats local modules. An inherited package is not a
    // way around the review gate: a human enabled it in the scope that owns it.
    if (!enabled) {
      enabled = [];
      for (const s of chain(scope)) {
        for (const p of await listEnabledPackages(s)) enabled.push(p.source);
      }
    }
    if (!enabled.includes(ref)) {
      throw new Error(
        `package not enabled in this scope or any it inherits: ${
          JSON.stringify(ref)
        } (enable it in the Library module)`,
      );
    }
    extensionPaths.push(ref);
  }
  return { extensionPaths, customTools };
}

// Skill refs → paths for additionalSkillPaths, which accepts directories as well as
// files. Named by path basename, never by SKILL.md frontmatter (skills/service.ts).
export async function resolveSkillRefs(
  scope: ScopeId,
  refs: string[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const ref of refs) {
    const path = await resolveSkillPath(scope, ref);
    if (!path) {
      throw new Error(
        `skill not found: ${JSON.stringify(ref)} (not in ${
          skillsDir(scope)
        } or an ancestor scope)`,
      );
    }
    paths.push(path);
  }
  return paths;
}
