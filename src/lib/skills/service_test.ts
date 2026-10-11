import { assertEquals } from "@std/assert";
import { listSkills } from "./service.ts";
import { skillsDir } from "./paths.ts";

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

async function writeDirSkill(name: string, text: string): Promise<void> {
  await Deno.mkdir(`${skillsDir()}/${name}`, { recursive: true });
  await Deno.writeTextFile(`${skillsDir()}/${name}/SKILL.md`, text);
}

async function writeFileSkill(name: string, text: string): Promise<void> {
  await Deno.mkdir(skillsDir(), { recursive: true });
  await Deno.writeTextFile(`${skillsDir()}/${name}.md`, text);
}

Deno.test("no skills dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listSkills(), []);
  });
});

Deno.test("both directory and loose-file skills are listed", async () => {
  await withTempHome(async () => {
    await writeDirSkill("changelog-style",
      "---\ndescription: d1\n---\nbody",
    );
    await writeFileSkill("terse", "---\ndescription: d2\n---\nbody");

    assertEquals(
      (await listSkills()).map((s) => ({
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
    await writeDirSkill("changelog-style",
      "---\nname: something-else\n---\nb",
    );

    const [skill] = await listSkills();
    assertEquals(skill.name, "changelog-style");
    assertEquals(skill.frontmatterName, "something-else");
  });
});

// The directory shape wins because `<name>/SKILL.md` is what pi itself treats as a
// skill root; a loose `<name>.md` sharing that name is the accident.
Deno.test("when both shapes share a name, the directory form wins and the loose file is dropped", async () => {
  await withTempHome(async () => {
    await writeDirSkill("foo", "---\ndescription: from dir\n---\nb");
    await writeFileSkill("foo", "---\ndescription: from file\n---\nb");

    const skills = await listSkills();
    assertEquals(skills.length, 1);
    assertEquals(skills[0].description, "from dir");
    assertEquals(skills[0].path, `${skillsDir()}/foo`);
  });
});

// Absent frontmatter is normal (a skill may be prompt text alone); malformed
// frontmatter is not, and parsePrompt's precedent (../prompts/parse.ts) is to report
// it via `error` rather than blend the two into the same blank description.
Deno.test("malformed frontmatter still lists the skill, with its name, and carries the error", async () => {
  await withTempHome(async () => {
    await writeDirSkill("broken",
      "---\ndescription: [unclosed\n---\nbody",
    );

    const [skill] = await listSkills();
    assertEquals(skill.name, "broken");
    assertEquals(skill.error?.startsWith("frontmatter:"), true);
  });
});
