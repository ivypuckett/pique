// Maps the skills into Library rows. Pure: Library.svelte owns the fetch.
import type { SkillInfo } from "./bindings.ts";
import type { LibraryItem } from "../library/items.ts";

export function skillItems(skills: SkillInfo[]): LibraryItem[] {
  return skills.map((skill) => ({
    kind: "skill" as const,
    key: `skill/${skill.path}`,
    title: skill.name,
    subtitle: skill.description,
    // Frontmatter that would not parse: the skill still loads, but its description is
    // missing and that is worth saying rather than showing a blank line.
    problem: skill.error,
    // pique names a skill by its path basename, never by the frontmatter `name:`. A
    // divergence is not an error — the skill works — but it is worth pointing out.
    note: skill.frontmatterName && skill.frontmatterName !== skill.name
      ? `Its frontmatter says ${skill.frontmatterName}; name it ${skill.name}.`
      : undefined,
    skill,
  }));
}
