import { assertEquals } from "@std/assert";
import { listSkills, listVisibleSkills, resolveSkillPath } from "./service.ts";
import { skillsDir } from "./paths.ts";
import type { ScopeId } from "../scope/paths.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function writeDirSkill(
  scope: ScopeId,
  name: string,
  text: string,
): Promise<void> {
  await Deno.mkdir(`${skillsDir(scope)}/${name}`, { recursive: true });
  await Deno.writeTextFile(`${skillsDir(scope)}/${name}/SKILL.md`, text);
}

async function writeFileSkill(
  scope: ScopeId,
  name: string,
  text: string,
): Promise<void> {
  await Deno.mkdir(skillsDir(scope), { recursive: true });
  await Deno.writeTextFile(`${skillsDir(scope)}/${name}.md`, text);
}

Deno.test("a scope with no skills dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listSkills("ws-1"), []);
  });
});

Deno.test("both directory and loose-file skills are listed", async () => {
  await withTempHome(async () => {
    await writeDirSkill(
      "ws-1",
      "changelog-style",
      "---\ndescription: d1\n---\nbody",
    );
    await writeFileSkill("ws-1", "terse", "---\ndescription: d2\n---\nbody");

    assertEquals(
      (await listSkills("ws-1")).map((s) => ({
        name: s.name,
        description: s.description,
      })),
      [
        { name: "changelog-style", description: "d1" },
        { name: "terse", description: "d2" },
      ],
    );
  });
});

// Decision 5: the basename is the name. A frontmatter `name:` that disagrees is
// reported so the mismatch is visible, but it is NOT what the skill is named here.
Deno.test("a frontmatter name that disagrees with the basename is reported, not used", async () => {
  await withTempHome(async () => {
    await writeDirSkill(
      "ws-1",
      "changelog-style",
      "---\nname: something-else\n---\nb",
    );

    const [skill] = await listSkills("ws-1");
    assertEquals(skill.name, "changelog-style");
    assertEquals(skill.frontmatterName, "something-else");
  });
});

Deno.test("a workspace sees root's skills and its own, nearest name winning", async () => {
  await withTempHome(async () => {
    await writeDirSkill(
      "root",
      "shared",
      "---\ndescription: from root\n---\nb",
    );
    await writeDirSkill(
      "root",
      "overridden",
      "---\ndescription: from root\n---\nb",
    );
    await writeDirSkill(
      "ws-1",
      "overridden",
      "---\ndescription: from ws\n---\nb",
    );

    const byName = new Map(
      (await listVisibleSkills("ws-1")).map((s) => [s.name, s.description]),
    );
    assertEquals(byName.get("shared"), "from root");
    assertEquals(byName.get("overridden"), "from ws");
  });
});

Deno.test("resolveSkillPath prefers the nearest scope and returns undefined when absent", async () => {
  await withTempHome(async () => {
    await writeDirSkill("root", "shared", "---\n---\nb");
    await writeDirSkill("ws-1", "shared", "---\n---\nb");

    assertEquals(
      await resolveSkillPath("ws-1", "shared"),
      `${skillsDir("ws-1")}/shared`,
    );
    assertEquals(await resolveSkillPath("ws-1", "nope"), undefined);
  });
});
