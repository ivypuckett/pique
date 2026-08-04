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
//   anything else   a package source, which must already be enabled in this scope
//
// The last check is what stops an automaton from being a way around the review gate:
// pi would happily fetch and load `npm:anything` handed to additionalExtensionPaths.
// Packages are not inherited (docs/extensions.md), so only the launching scope counts.
// Runs Deno-side only.
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { kanbanTools } from "../kanban/agent-tools.ts";
import { extensionAuthoringTools } from "../extensions/agent-tools.ts";
import { promptAuthoringTools } from "../prompts/agent-tools.ts";
import { listEnabledPackages } from "../extensions/packages.ts";
import { livePath } from "../extensions/paths.ts";
import { resolveSkillPath } from "../skills/service.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

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
async function resolveLocal(
  scope: ScopeId,
  name: string,
): Promise<string | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    const path = livePath(s, name);
    try {
      if ((await Deno.stat(path)).isFile) return path;
    } catch {
      continue;
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

  for (const ref of refs) {
    if (ref.startsWith("pique:")) {
      const group = BUILTIN_GROUPS[ref.slice("pique:".length)];
      if (!group) {
        throw new Error(
          `unknown built-in group: ${ref} (known: ${
            Object.keys(BUILTIN_GROUPS).map((g) => `pique:${g}`).join(", ")
          })`,
        );
      }
      customTools.push(...group(scope));
      continue;
    }

    if (LOCAL_NAME_RE.test(ref)) {
      const path = await resolveLocal(scope, ref);
      if (!path) {
        throw new Error(
          `extension not found or not enabled: ${ref} (enable it in Library → Extensions)`,
        );
      }
      extensionPaths.push(path);
      continue;
    }

    enabled ??= (await listEnabledPackages(scope)).map((p) => p.source);
    if (!enabled.includes(ref)) {
      throw new Error(
        `package not enabled in this scope: ${ref} (enable it in Library → Extensions)`,
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
    if (!path) throw new Error(`skill not found: ${ref}`);
    paths.push(path);
  }
  return paths;
}
