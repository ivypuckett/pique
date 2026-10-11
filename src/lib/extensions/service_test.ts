import { assertEquals, assertThrows } from "@std/assert";
import {
  extensionId,
  extensionLoadErrors,
  listExtensions,
  parseId,
  readExtension,
  removeExtension,
} from "./service.ts";
import { ensureExtensionDirs, livePath } from "./paths.ts";

// A module that really does import and register, so "loads" vs "does not load" is a
// distinction the loader draws rather than one the fixture asserts.
const HEALTHY_EXTENSION =
  `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fixture_tool",
    label: "fixture_tool",
    description: "service fixture",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: null };
    },
  });
}
`;

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

async function seedLocal(name: string, source = "// src"): Promise<void> {
  await ensureExtensionDirs();
  await Deno.writeTextFile(livePath(name), source);
}

Deno.test("ids split on the first colon, so a package source keeps its own", () => {
  assertEquals(parseId(extensionId("package", "npm:pi-crew")), {
    origin: "package",
    key: "npm:pi-crew",
  });
  assertEquals(parseId("local:weather"), { origin: "local", key: "weather" });
  assertThrows(() => parseId("nocolon"));
  assertThrows(() => parseId("other:x"));
});

Deno.test("an empty agent dir lists nothing of either origin", async () => {
  await withTempHome(async () => {
    assertEquals(await listExtensions(), []);
  });
});

Deno.test("a local extension is listed, read, and removed by its id", async () => {
  await withTempHome(async () => {
    await seedLocal("weather", "export default () => {};");
    const [ext] = await listExtensions();
    assertEquals(ext, {
      id: "local:weather",
      name: "weather",
      origin: "local",
    });
    const source = await readExtension(ext.id);
    assertEquals(source.files, [{
      path: "weather.ts",
      text: "export default () => {};",
    }]);
    assertEquals(source.truncated, false);
    await removeExtension(ext.id);
    assertEquals(await listExtensions(), []);
  });
});

Deno.test("a long source is clamped for display, and says so", async () => {
  await withTempHome(async () => {
    await seedLocal("big", "x".repeat(250_000));
    const source = await readExtension("local:big");
    assertEquals(source.truncated, true);
    assertEquals(source.files[0].text.length, 200_000);
  });
});

// Load failures. An extension that will not import is still in pi's loading set, so the
// list alone cannot distinguish it from one that works.
Deno.test("a broken extension is reported, a healthy one is not", async () => {
  await withTempHome(async () => {
    await seedLocal("healthy", HEALTHY_EXTENSION);
    await seedLocal("broken", "this is not valid typescript ((((");

    const errors = await extensionLoadErrors();

    assertEquals(
      errors.map((e) => e.name),
      ["broken"],
      "only the one that cannot load is named",
    );
    assertEquals(
      errors[0].error.length > 0,
      true,
      "with a reason to show the user",
    );
  });
});

Deno.test("an agent dir whose extensions all load reports nothing", async () => {
  await withTempHome(async () => {
    await seedLocal("fine", HEALTHY_EXTENSION);
    assertEquals(await extensionLoadErrors(), []);
  });
});
