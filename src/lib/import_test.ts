import { assertEquals, assertRejects } from "@std/assert";
import { importFromPi } from "./import.ts";
import { agentDir, piAgentDir } from "./paths.ts";

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

async function write(path: string, text: string): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, text);
}

const read = (path: string) => Deno.readTextFile(path);

Deno.test("pi's setup comes across, and its chat history does not", async () => {
  await withTempHome(async () => {
    const pi = piAgentDir();
    await write(`${pi}/extensions/weather.ts`, "// weather");
    await write(`${pi}/prompts/review.md`, "review");
    await write(`${pi}/auth.json`, '{"anthropic":{}}');
    await write(`${pi}/sessions/x/1.jsonl`, "{}");

    const result = await importFromPi();

    assertEquals(await read(`${agentDir()}/extensions/weather.ts`), "// weather");
    assertEquals(await read(`${agentDir()}/prompts/review.md`), "review");
    assertEquals(await read(`${agentDir()}/auth.json`), '{"anthropic":{}}');
    await assertRejects(() => Deno.stat(`${agentDir()}/sessions`));
    assertEquals(result, { copied: 3, kept: 0 });
  });
});

// Importing after setting things up here, or twice, must not undo anything.
Deno.test("a file pique already has keeps pique's copy", async () => {
  await withTempHome(async () => {
    await write(`${piAgentDir()}/SYSTEM.md`, "pi's");
    await write(`${agentDir()}/SYSTEM.md`, "mine");

    const result = await importFromPi();

    assertEquals(await read(`${agentDir()}/SYSTEM.md`), "mine");
    assertEquals(result, { copied: 0, kept: 1 });
  });
});

// Skipping settings.json because pique has one would leave every pi package behind.
Deno.test("settings are merged: pique's values win, packages are joined", async () => {
  await withTempHome(async () => {
    await write(
      `${piAgentDir()}/settings.json`,
      JSON.stringify({
        defaultModel: "theirs",
        theme: "dark",
        packages: ["npm:shared", { source: "npm:theirs" }],
      }),
    );
    await write(
      `${agentDir()}/settings.json`,
      JSON.stringify({ defaultModel: "mine", packages: ["npm:shared"] }),
    );

    await importFromPi();

    assertEquals(JSON.parse(await read(`${agentDir()}/settings.json`)), {
      defaultModel: "mine",
      theme: "dark",
      packages: ["npm:shared", { source: "npm:theirs" }],
    });
  });
});

Deno.test("an installed package's links stay links", async () => {
  await withTempHome(async () => {
    const pi = piAgentDir();
    await write(`${pi}/npm/node_modules/pkg/cli.js`, "// cli");
    await Deno.mkdir(`${pi}/npm/node_modules/.bin`, { recursive: true });
    await Deno.symlink("../pkg/cli.js", `${pi}/npm/node_modules/.bin/pkg`);

    await importFromPi();

    const bin = `${agentDir()}/npm/node_modules/.bin/pkg`;
    assertEquals(await Deno.readLink(bin), "../pkg/cli.js");
    assertEquals(await read(bin), "// cli");
  });
});

Deno.test("there is nothing to import from a missing pi setup, or into pi's own", async () => {
  await withTempHome(async () => {
    await assertRejects(() => importFromPi(), Error, "No pi setup");
    await Deno.mkdir(piAgentDir(), { recursive: true });
    await assertRejects(
      () => importFromPi(piAgentDir(), piAgentDir()),
      Error,
      "already pi's own folder",
    );
  });
});
