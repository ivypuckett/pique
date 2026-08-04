// Backend service for skills: what a scope has, and where a named one lives.
// Read-only by design (docs/automatons.md) — the Library sub-tab shows this list and
// the automaton editor picks from it. Runs Deno-side only.
import { extract } from "@std/front-matter/yaml";
import { assertSkillName, skillsDir } from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

// A type alias, not an interface, so it keeps TypeScript's implicit index signature
// and can cross the win.bind boundary as a JSON value.
export type SkillInfo = {
  // The path basename. THIS is what an automaton names (design decision 5).
  name: string;
  description: string;
  // Absolute path to the skill dir or file, ready for pi's additionalSkillPaths.
  path: string;
  scope: ScopeId;
  // The frontmatter `name:` when it disagrees with the basename. Shown in the UI so
  // the divergence is visible rather than mysterious; never used for resolution.
  frontmatterName?: string;
  // Set only when frontmatter is PRESENT but malformed (parsePrompt's precedent, in
  // ../prompts/parse.ts). A file with no frontmatter at all is normal and leaves this
  // unset — the two are not the same thing, and collapsing them would hide a typo'd
  // YAML block behind a silently blank description.
  error?: string;
};

type Meta = { description: string; frontmatterName?: string; error?: string };

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

// Frontmatter only; the body is the skill's text and is not needed for a listing.
// A file with no frontmatter still lists, with an empty description, because a
// skill may legitimately be prompt text alone. Malformed frontmatter also still
// lists — one bad file must not blank the whole dir — but is reported via `error`
// rather than silently treated the same as "none".
function meta(text: string): Meta {
  try {
    const attrs = extract(text).attrs as Record<string, unknown>;
    return {
      description: str(attrs.description) ?? "",
      frontmatterName: str(attrs.name),
    };
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      return {
        description: "",
        error: `frontmatter: ${(err as Error).message}`,
      };
    }
    return { description: "" };
  }
}

async function readMeta(path: string): Promise<Meta> {
  try {
    return meta(await Deno.readTextFile(path));
  } catch {
    // The file vanished between readDir and here (a real race, not a parse
    // problem) — list it with what we know rather than dropping it.
    return { description: "" };
  }
}

// One scope's own skills. pi's two shapes: `<name>/SKILL.md` and a loose `<name>.md`.
// A missing dir means "none yet", not an error. A basename that is not a legal name
// is skipped rather than raising.
export async function listSkills(scope: ScopeId): Promise<SkillInfo[]> {
  const dir = skillsDir(scope);
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }

  // The two shapes can share a basename — `foo/SKILL.md` next to a stray `foo.md`.
  // They MUST collapse to one entry here: listVisibleSkills' Map keeps the last
  // insert while resolveSkillPath's .find() takes the first, so without this a
  // duplicate would make the two consumers disagree about which file "foo" even is
  // — the Library UI showing one skill's description while an automaton launches
  // the other. The directory form wins: `<name>/SKILL.md` is the shape pi itself
  // treats as a skill root, so a loose `<name>.md` beside it is the accident, and
  // the loser is dropped silently rather than surfaced as a conflict.
  const dirs = new Map<string, SkillInfo>();
  const files = new Map<string, SkillInfo>();

  for (const entry of entries) {
    let name: string;
    let path: string;
    let metaPath: string;
    let target: Map<string, SkillInfo>;
    if (entry.isDirectory) {
      name = entry.name;
      path = `${dir}/${entry.name}`;
      metaPath = `${path}/SKILL.md`;
      try {
        if (!(await Deno.stat(metaPath)).isFile) continue;
      } catch {
        // A directory with no SKILL.md is not a skill — pi would recurse into it
        // looking for one, but a nested skill is not nameable here.
        continue;
      }
      target = dirs;
    } else if (entry.isFile && entry.name.endsWith(".md")) {
      name = entry.name.slice(0, -3);
      path = `${dir}/${entry.name}`;
      metaPath = path;
      target = files;
    } else continue;

    try {
      assertSkillName(name);
    } catch {
      continue;
    }
    target.set(name, { name, path, scope, ...await readMeta(metaPath) });
  }

  for (const [name, info] of files) {
    if (!dirs.has(name)) dirs.set(name, info);
  }
  return [...dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Every skill nameable in `scope`: its own plus each ancestor's, nearest winning. The
// de-duplication matters — pi collapses a name collision itself and takes the first
// path, so listing a shadowed twin would offer something that can never be selected.
export async function listVisibleSkills(scope: ScopeId): Promise<SkillInfo[]> {
  const byName = new Map<string, SkillInfo>();
  for (const s of chain(scope)) {
    for (const skill of await listSkills(s)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

// The path an automaton's `skills:` entry resolves to, nearest scope first, or
// undefined when no scope on the chain has it. Undefined is what makes a launch fail
// loudly (automatons/resolve.ts) rather than run with less than its file says.
export async function resolveSkillPath(
  scope: ScopeId,
  name: string,
): Promise<string | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    const hit = (await listSkills(s)).find((k) => k.name === name);
    if (hit) return hit.path;
  }
  return undefined;
}
