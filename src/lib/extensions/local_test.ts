import { assertEquals, assertRejects } from "@std/assert";
import { listLocal, readLocalSource, removeLocal } from "./local.ts";
import { ensureExtensionDirs, liveDir, livePath } from "./paths.ts";

// Point HOME at a throwaway dir so the service reads/writes under a temp tree.
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

async function seed(name: string, source = "// src"): Promise<void> {
  await ensureExtensionDirs();
  await Deno.writeTextFile(livePath(name), source);
}

Deno.test("listLocal reports nothing before anything is written", async () => {
  await withTempHome(async () => {
    assertEquals(await listLocal(), []);
  });
});

Deno.test("every .ts in the extensions dir is listed, by name", async () => {
  await withTempHome(async () => {
    await seed("weather");
    await seed("alpha");
    assertEquals(await listLocal(), [{ name: "alpha" }, { name: "weather" }]);
  });
});

// A user module's two files sit beside the extensions; neither is one.
Deno.test("a module's definition and document are not mistaken for extensions", async () => {
  await withTempHome(async () => {
    await ensureExtensionDirs();
    await Deno.writeTextFile(`${liveDir()}/notes.module.json`, "{}");
    await Deno.writeTextFile(`${liveDir()}/notes.ui.html`, "<p></p>");
    assertEquals(await listLocal(), []);
  });
});

Deno.test("the source read is the bytes that run", async () => {
  await withTempHome(async () => {
    await seed("weather", "export default () => {};");
    assertEquals(await readLocalSource("weather"), "export default () => {};");
  });
});

Deno.test("remove deletes the file", async () => {
  await withTempHome(async () => {
    await seed("weather");
    await removeLocal("weather");
    assertEquals(await listLocal(), []);
  });
});

Deno.test("names that would escape the extensions dir are refused", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => removeLocal("../evil"),
      Error,
      "invalid extension name",
    );
    await assertRejects(
      () => readLocalSource("a/b"),
      Error,
      "invalid extension name",
    );
  });
});
