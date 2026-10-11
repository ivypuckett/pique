import { assertEquals, assertRejects } from "@std/assert";
import { deletePrompt, listPrompts, savePrompt } from "./service.ts";
import { ensurePromptDirs, promptPath, promptsDir } from "./paths.ts";

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

async function write(name: string, body: string): Promise<void> {
  await ensurePromptDirs();
  await Deno.writeTextFile(promptPath(name), body);
}

Deno.test("no prompts dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listPrompts(), []);
  });
});

Deno.test("templates are listed by name, with their frontmatter", async () => {
  await withTempHome(async () => {
    await write("review", "---\ndescription: d\n---\nbody");
    await write("audit", "---\n---\nbody");
    const listed = await listPrompts();
    assertEquals(listed.map((p) => p.name), ["audit", "review"]);
    assertEquals(listed[1].description, "d");
  });
});

// The dir is user-editable, so one stray file must not break the listing.
Deno.test("non-markdown files and illegal names are skipped", async () => {
  await withTempHome(async () => {
    await write("ok", "body");
    await Deno.writeTextFile(`${promptsDir()}/notes.txt`, "x");
    await Deno.writeTextFile(`${promptsDir()}/Bad Name.md`, "x");

    assertEquals((await listPrompts()).map((p) => p.name), ["ok"]);
  });
});

Deno.test("saving writes a template a chat can invoke straight away", async () => {
  await withTempHome(async () => {
    await savePrompt("ship", {
      description: "Ship it",
      argumentHint: "<pr>",
      body: "Merge $1",
    });

    const [p] = await listPrompts();
    assertEquals(p.description, "Ship it");
    assertEquals(p.argumentHint, "<pr>");
    assertEquals(p.body, "Merge $1");
  });
});

Deno.test("saving an existing name replaces it rather than adding a second", async () => {
  await withTempHome(async () => {
    await savePrompt("ship", { description: "one", body: "a" });
    await savePrompt("ship", { description: "two", body: "b" });

    const listed = await listPrompts();
    assertEquals(listed.length, 1);
    assertEquals(listed[0].description, "two");
  });
});

Deno.test("a name that could escape the prompts dir is rejected before any write", async () => {
  await withTempHome(async () => {
    await assertRejects(() =>
      savePrompt("../escape", { description: "d", body: "b" })
    );
    await assertRejects(() => deletePrompt("../escape"));
  });
});

Deno.test("deleting removes the template", async () => {
  await withTempHome(async () => {
    await savePrompt("ship", { description: "d", body: "b" });
    await deletePrompt("ship");
    assertEquals(await listPrompts(), []);
  });
});
