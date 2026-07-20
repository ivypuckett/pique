import { assertEquals, assertRejects } from "@std/assert";
import { listDir } from "./fs.ts";

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
