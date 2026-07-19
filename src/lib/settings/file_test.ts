import { assertEquals, assertRejects } from "@std/assert";
import { readJson, writeJson } from "./file.ts";

// Each test runs against a throwaway HOME so it exercises real disk I/O without
// touching the developer's own ~/.pique.
async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const tmp = await Deno.makeTempDir();
  Deno.env.set("HOME", tmp);
  try {
    await fn();
  } finally {
    if (prev !== undefined) Deno.env.set("HOME", prev);
    else Deno.env.delete("HOME");
    await Deno.remove(tmp, { recursive: true });
  }
}

Deno.test("readJson returns null when the file is absent", async () => {
  await withTempHome(async () => {
    assertEquals(await readJson("settings"), null);
  });
});

Deno.test("writeJson then readJson round-trips", async () => {
  await withTempHome(async () => {
    await writeJson("settings", { a: 1, nested: { b: true } });
    assertEquals(await readJson("settings"), { a: 1, nested: { b: true } });
  });
});

Deno.test("writeJson creates ~/.pique when missing", async () => {
  await withTempHome(async () => {
    await writeJson("layout", { x: true });
    const stat = await Deno.stat(`${Deno.env.get("HOME")}/.pique`);
    assertEquals(stat.isDirectory, true);
  });
});

Deno.test("readJson returns null on corrupt json", async () => {
  await withTempHome(async () => {
    await Deno.mkdir(`${Deno.env.get("HOME")}/.pique`, { recursive: true });
    await Deno.writeTextFile(`${Deno.env.get("HOME")}/.pique/settings.json`, "{ not json");
    assertEquals(await readJson("settings"), null);
  });
});

Deno.test("writeJson rejects names with path separators", async () => {
  await withTempHome(async () => {
    await assertRejects(() => writeJson("../evil", {}));
  });
});
