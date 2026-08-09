// Maps a scope's visible skills into Library rows. Pure: Library.svelte owns the fetch.
import type { SkillInfo } from "./bindings.ts";
import type { LibraryItem } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";

// `visible` is every skill nameable in `scope` — its own plus each ancestor's, already
// de-duplicated by nearest-wins in skills/service.ts, so a name appears exactly once.
// A skill is never pending: it is markdown a model reads, not code that executes, so
// there is nothing to review and nothing to enable.
export function skillItems(
  visible: SkillInfo[],
  scope: ScopeId,
): LibraryItem[] {
  return visible.map((skill) => ({
    kind: "skill" as const,
    key: `skill/${skill.scope}/${skill.path}`,
    scope: skill.scope,
    state: skill.scope === scope ? "active" : "inherited",
    title: skill.name,
    subtitle: skill.description,
    // Frontmatter that would not parse: the skill still loads, but its description is
    // missing and that is worth saying rather than showing a blank line.
    problem: skill.error,
    // An automaton names a skill by its path basename, never by the frontmatter `name:`.
    // A divergence is not an error — the skill works — but it will make a `skills:`
    // entry that copies the frontmatter fail to resolve.
    note: skill.frontmatterName && skill.frontmatterName !== skill.name
      ? `Its frontmatter says ${skill.frontmatterName}; name it ${skill.name}.`
      : undefined,
    skill,
  }));
}
