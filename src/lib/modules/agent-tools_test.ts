import { assertEquals, assertRejects } from "@std/assert";
import { moduleAuthoringTools } from "./agent-tools.ts";
import { listModules } from "./service.ts";

// A throwaway HOME, mirroring extensions/local_test.ts: every path in scope/paths.ts is
// built from home(), so pointing HOME at a temp dir isolates the whole tree.
async function withScope(fn: () => Promise<void>) {
  const dir = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

// deno-lint-ignore no-explicit-any
const run = (scope: string, args: any) => {
  const tool = moduleAuthoringTools(scope)[0];
  // deno-lint-ignore no-explicit-any
  return (tool as any).execute("call-1", args);
};

const good = {
  name: "notes",
  label: "Notes",
  html: "<p>hi</p>",
};

Deno.test("define_module writes a module straight into use", async () => {
  await withScope(async () => {
    await run("root", good);
    const { modules, errors } = await listModules("root");
    assertEquals(modules.map((m) => [m.kind, m.label]), [["notes", "Notes"]]);
    assertEquals(errors, []);
  });
});

Deno.test("a name colliding with a built-in module is refused", async () => {
  await withScope(async () => {
    await assertRejects(() => run("root", { ...good, name: "terminal" }), Error);
    assertEquals((await listModules("root")).modules, []);
  });
});

Deno.test("a name that could escape the directory is refused", async () => {
  await withScope(async () => {
    for (const name of ["../x", "a/b", "Notes"]) {
      await assertRejects(() => run("root", { ...good, name }), Error);
    }
    assertEquals((await listModules("root")).modules, []);
  });
});

// Nothing beside the document is served, so a relative reference never loads — and the
// agent, which cannot see the frame, would not find out. The tool says so instead.
Deno.test("a relative script or stylesheet reference is refused", async () => {
  await withScope(async () => {
    await assertRejects(
      () => run("root", { ...good, html: `<script src="./app.js"></script>` }),
      Error,
      "inline",
    );
    await assertRejects(
      () => run("root", { ...good, html: `<link rel="stylesheet" href="a.css">` }),
      Error,
      "inline",
    );
    assertEquals((await listModules("root")).modules, []);
  });
});

// The frame can reach the network, so a library from a CDN is the author's call.
Deno.test("an absolute script or stylesheet reference is allowed", async () => {
  await withScope(async () => {
    await run("root", {
      ...good,
      html: `<script src="https://cdn.example/x.js"></script>` +
        `<link rel="stylesheet" href="//cdn.example/x.css">`,
    });
    assertEquals((await listModules("root")).modules.length, 1);
  });
});

Deno.test("rewriting a module replaces it", async () => {
  await withScope(async () => {
    await run("root", good);
    await run("root", { ...good, label: "Notes v2" });
    const { modules } = await listModules("root");
    assertEquals(modules.map((m) => m.label), ["Notes v2"]);
  });
});
