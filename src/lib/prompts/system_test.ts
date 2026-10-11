import { assertEquals } from "@std/assert";
import {
  deletePromptFile,
  listPromptFiles,
  promptFilePath,
  readPromptFiles,
  savePromptFile,
} from "./system.ts";

async function withTempHome(fn: (home: string) => Promise<void>) {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn(dir);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

// pi's own filenames in pi's own agent dir — which is what lets pi find them without
// pique handing them over.
Deno.test("the two files are pi's own, in pi's agent dir", async () => {
  await withTempHome((home) => {
    assertEquals(promptFilePath("system"), `${home}/.pi/agent/SYSTEM.md`);
    assertEquals(
      promptFilePath("appendix"),
      `${home}/.pi/agent/APPEND_SYSTEM.md`,
    );
    return Promise.resolve();
  });
});

Deno.test("listPromptFiles reports both files, present or not", async () => {
  await withTempHome(async () => {
    await savePromptFile("appendix", "house rules");
    const files = await listPromptFiles();
    assertEquals(files.map((f) => [f.kind, f.body]), [
      ["system", undefined],
      ["appendix", "house rules"],
    ]);
  });
});

Deno.test("saving an empty body deletes the file rather than emptying it", async () => {
  await withTempHome(async () => {
    await savePromptFile("system", "BASE");
    await savePromptFile("system", "   \n");
    assertEquals((await listPromptFiles())[0].body, undefined);
  });
});

Deno.test("deleting a file that is not there is not an error", async () => {
  await withTempHome(async () => {
    await deletePromptFile("system");
  });
});

Deno.test("readPromptFiles moves when either file does", async () => {
  await withTempHome(async () => {
    const none = readPromptFiles();
    await savePromptFile("appendix", "rules");
    const appended = readPromptFiles();
    await savePromptFile("system", "base");
    const both = readPromptFiles();
    assertEquals(new Set([none, appended, both]).size, 3);
  });
});
