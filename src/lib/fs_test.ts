import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  createEntry,
  listDir,
  parseEntryName,
  removeEntry,
  renameEntry,
} from "./fs.ts";

Deno.test("listDir returns entries with isDir/isSymlink flags", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/sub`);
    await Deno.writeTextFile(`${dir}/file.txt`, "hi");
    await Deno.symlink(`${dir}/file.txt`, `${dir}/link`);

    const entries = await listDir(dir);
    const byName = new Map(entries.map((e) => [e.name, e]));

    assertEquals(byName.get("sub")!.isDir, true);
    assertEquals(byName.get("sub")!.path, `${dir}/sub`);
    assertEquals(byName.get("file.txt")!.isDir, false);
    assertEquals(byName.get("link")!.isSymlink, true);
    assertEquals(byName.get("link")!.isDir, false); // not followed
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("listDir rejects on a missing path", async () => {
  await assertRejects(() => listDir("/no/such/path/here"));
});

Deno.test("parseEntryName reads a trailing slash as a directory", () => {
  assertEquals(parseEntryName("notes.md"), { rel: "notes.md", isDir: false });
  assertEquals(parseEntryName("docs/"), { rel: "docs", isDir: true });
  assertEquals(parseEntryName(" a/b/c.ts "), { rel: "a/b/c.ts", isDir: false });
});

Deno.test("parseEntryName refuses names that could escape the parent", () => {
  assertThrows(() => parseEntryName(""));
  assertThrows(() => parseEntryName("   "));
  assertThrows(() => parseEntryName("/etc/passwd"));
  assertThrows(() => parseEntryName("../sibling.ts"));
  assertThrows(() => parseEntryName("a/../../b.ts"));
  assertThrows(() => parseEntryName("a//b.ts"));
  assertThrows(() => parseEntryName("..\\sibling.ts"));
  assertThrows(() => parseEntryName("a\\..\\..\\b.ts"));
});

Deno.test("createEntry makes files, directories, and missing parents", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await createEntry(dir, "notes.md"), `${dir}/notes.md`);
    assertEquals(await Deno.readTextFile(`${dir}/notes.md`), "");

    await createEntry(dir, "docs/");
    assertEquals((await Deno.lstat(`${dir}/docs`)).isDirectory, true);

    await createEntry(dir, "a/b/c.ts");
    assertEquals((await Deno.lstat(`${dir}/a/b/c.ts`)).isFile, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("createEntry refuses a name that is already taken", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/taken.txt`, "keep me");
    await Deno.mkdir(`${dir}/sub`);

    await assertRejects(() => createEntry(dir, "taken.txt"));
    await assertRejects(() => createEntry(dir, "sub/"));
    assertEquals(await Deno.readTextFile(`${dir}/taken.txt`), "keep me"); // not truncated
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renameEntry moves within the same directory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/old.txt`, "body");

    assertEquals(
      await renameEntry(`${dir}/old.txt`, "new.txt"),
      `${dir}/new.txt`,
    );
    assertEquals(await Deno.readTextFile(`${dir}/new.txt`), "body");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renameEntry refuses to clobber an existing entry", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/a.txt`, "a");
    await Deno.writeTextFile(`${dir}/b.txt`, "b");

    await assertRejects(() => renameEntry(`${dir}/a.txt`, "b.txt"));
    assertEquals(await Deno.readTextFile(`${dir}/b.txt`), "b");
    assertEquals(await Deno.readTextFile(`${dir}/a.txt`), "a"); // source untouched
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("removeEntry deletes files and non-empty directories", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/gone.txt`, "x");
    await Deno.mkdir(`${dir}/tree/deep`, { recursive: true });
    await Deno.writeTextFile(`${dir}/tree/deep/child.txt`, "x");

    await removeEntry(`${dir}/gone.txt`);
    await removeEntry(`${dir}/tree`);

    assertEquals((await listDir(dir)).length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
