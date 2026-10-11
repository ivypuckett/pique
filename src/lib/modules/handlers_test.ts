import { assertEquals, assertThrows } from "@std/assert";
import { handlersFor } from "./handlers.ts";

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

Deno.test("a module's storage starts empty and keeps what it is given", async () => {
  await withTempHome(async () => {
    const h = handlersFor("notes");
    assertEquals(await h.storageGet(undefined), null);
    await h.storageSet({ cards: [1, 2] });
    assertEquals(await h.storageGet(undefined), { cards: [1, 2] });
  });
});

Deno.test("two modules' storage is kept apart", async () => {
  await withTempHome(async () => {
    await handlersFor("notes").storageSet("mine");
    assertEquals(await handlersFor("board").storageGet(undefined), null);
  });
});

Deno.test("files are read and written where the module says", async (t) => {
  await withTempHome(async (home) => {
    const h = handlersFor("notes");
    await h.fsWrite({ path: `${home}/a.md`, contents: "hello" });
    assertEquals(await h.fsRead({ path: `${home}/a.md` }), "hello");
    await t.step("nothing else is offered", () => {
      assertEquals(Object.keys(h).sort(), [
        "fsRead",
        "fsWrite",
        "storageGet",
        "storageSet",
      ]);
    });
  });
});

// The id names the storage file, so it must not be able to escape the storage dir.
Deno.test("a module id that is not a legal name is refused", () => {
  assertThrows(() => handlersFor("../x"));
});
