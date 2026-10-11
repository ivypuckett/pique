import { assertEquals, assertRejects } from "@std/assert";
import { listModules, removeModule } from "./service.ts";

// A throwaway HOME, mirroring extensions/local_test.ts: every path in paths.ts is built
// from home(), so pointing HOME at a temp dir isolates the whole tree.
async function withScope(
  fn: (
    write: (name: string, ext: string, body: string) => Promise<void>,
  ) => Promise<void>,
) {
  const dir = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", dir);
  const live = `${dir}/.pique/agent/extensions`;
  await Deno.mkdir(live, { recursive: true });
  try {
    await fn((name, ext, body) =>
      Deno.writeTextFile(`${live}/${name}.${ext}`, body)
    );
  } finally {
    if (prev === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

const definition = (label: string) =>
  JSON.stringify({ label });

Deno.test("a definition with its document is a module", async () => {
  await withScope(async (write) => {
    await write("notes", "module.json", definition("Notes"));
    await write("notes", "ui.html", "<p>hi</p>");
    const { modules, errors } = await listModules();
    assertEquals(errors, []);
    assertEquals(modules.length, 1);
    assertEquals(modules[0].kind, "notes");
  });
});

// The document is what the frame loads. A definition without one would put a row on the
// rail that opens an empty panel.
Deno.test("a definition with no document is an error, not a module", async () => {
  await withScope(async (write) => {
    await write("notes", "module.json", definition("Notes"));
    const { modules, errors } = await listModules();
    assertEquals(modules, []);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].error.includes("ui.html"), true);
  });
});

// The failure that matters most: one bad file must not empty the list.
Deno.test("a junk definition is reported beside the modules that did parse", async () => {
  await withScope(async (write) => {
    await write("good", "module.json", definition("Good"));
    await write("good", "ui.html", "<p>ok</p>");
    await write("bad", "module.json", "{not json");
    await write("bad", "ui.html", "<p>ok</p>");
    const { modules, errors } = await listModules();
    assertEquals(modules.map((m) => m.kind), ["good"]);
    assertEquals(errors.map((e) => e.name), ["bad"]);
  });
});

// A .ts is not required: a module that only draws a panel needs no pi extension, and on
// Deno 2.9.5 a malformed one panics the app at boot.
Deno.test("a module needs no extension .ts beside it", async () => {
  await withScope(async (write) => {
    await write("notes", "module.json", definition("Notes"));
    await write("notes", "ui.html", "<p>hi</p>");
    const { modules } = await listModules();
    assertEquals(modules.length, 1);
  });
});

Deno.test("no extensions dir means no modules and no errors", async () => {
  await withScope(async () => {
    await Deno.remove(`${Deno.env.get("HOME")}/.pique/agent/extensions`, {
      recursive: true,
    });
    const { modules, errors } = await listModules();
    assertEquals(modules, []);
    assertEquals(errors, []);
  });
});

Deno.test("removing a module deletes its definition and its document", async () => {
  await withScope(async (write) => {
    await write("notes", "module.json", definition("Notes"));
    await write("notes", "ui.html", "<p>hi</p>");
    await removeModule("notes");
    const { modules, errors } = await listModules();
    assertEquals(modules, []);
    assertEquals(errors, []);
  });
});

// A half-installed module is listed with an error, and Delete is how it is cleared.
Deno.test("removing a module with its document already gone still succeeds", async () => {
  await withScope(async (write) => {
    await write("notes", "module.json", definition("Notes"));
    await removeModule("notes");
    assertEquals((await listModules()).errors, []);
  });
});

Deno.test("removing refuses a name that could escape the directory", async () => {
  await withScope(async () => {
    await assertRejects(() => removeModule("../x"));
  });
});
