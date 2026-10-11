import { assertEquals, assertRejects } from "@std/assert";
import { moduleAuthoringTools } from "./agent-tools.ts";
import { listModules, listPendingModules } from "./service.ts";

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
  rationale: "A scratchpad beside the board.",
  html: "<p>hi</p>",
};

Deno.test("define_module writes a module to the gate, not into use", async () => {
  await withScope(async () => {
    await run("root", good);
    const pending = await listPendingModules("root");
    assertEquals(pending.map((p) => p.name), ["notes"]);
    assertEquals(pending[0].def?.label, "Notes");
    // The whole point: an agent-authored module does not run until a human consents.
    assertEquals((await listModules("root")).modules, []);
  });
});

Deno.test("the capabilities it asks for are recorded for the consent screen", async () => {
  await withScope(async () => {
    await run("root", { ...good, capabilities: { storage: true } });
    const [p] = await listPendingModules("root");
    assertEquals(p.def?.capabilities.storage, true);
  });
});

Deno.test("a module asking for nothing gets nothing", async () => {
  await withScope(async () => {
    await run("root", good);
    const [p] = await listPendingModules("root");
    assertEquals(p.def?.capabilities, {});
  });
});

// The tool validates through the same parseDefinition the Library and the broker use,
// so an agent is told what is wrong at authoring time instead of the user meeting a
// broken row later.
Deno.test("an unknown capability is refused at authoring time", async () => {
  await withScope(async () => {
    await assertRejects(
      () => run("root", { ...good, capabilities: { network: true } }),
      Error,
      "network",
    );
    assertEquals(await listPendingModules("root"), []);
  });
});

Deno.test("a name colliding with a built-in module is refused", async () => {
  await withScope(async () => {
    await assertRejects(() => run("root", { ...good, name: "terminal" }), Error);
    assertEquals(await listPendingModules("root"), []);
  });
});

Deno.test("a name that could escape the directory is refused", async () => {
  await withScope(async () => {
    for (const name of ["../x", "a/b", "Notes"]) {
      await assertRejects(() => run("root", { ...good, name }), Error);
    }
    assertEquals(await listPendingModules("root"), []);
  });
});

// Nothing may reach the live dir through this tool, whatever it is asked for. If this
// ever passes with a live module, the gate has been bypassed.
Deno.test("neither file lands in the live dir", async () => {
  await withScope(async () => {
    await run("root", { ...good, capabilities: { storage: true } });
    assertEquals((await listModules("root")).modules, []);
    assertEquals((await listModules("root")).errors, []);
  });
});

// A module is one document. A caller that ships a <script src> gets a module whose
// script will not load, so the tool says so rather than letting it fail silently in a
// frame that cannot report anything.
Deno.test("an external script or stylesheet reference is refused", async () => {
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
  });
});

Deno.test("rewriting a module returns it to the gate", async () => {
  await withScope(async () => {
    await run("root", good);
    await run("root", { ...good, label: "Notes v2" });
    const pending = await listPendingModules("root");
    assertEquals(pending.length, 1);
    assertEquals(pending[0].def?.label, "Notes v2");
  });
});
