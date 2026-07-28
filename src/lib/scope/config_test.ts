import { assertEquals } from "@std/assert";
import { mergeConfig, readScopeConfig, resolveScopeConfig, writeScopeConfig } from "./config.ts";
import { ROOT, scopeConfigPath } from "./paths.ts";

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

Deno.test("mergeConfig layers plain objects key by key", () => {
  assertEquals(
    mergeConfig({ chat: { defaultModel: "a", defaultThinkingLevel: "high" } }, {
      chat: { defaultModel: "b" },
    }),
    // The override sets only the model; the thinking level is still inherited.
    { chat: { defaultModel: "b", defaultThinkingLevel: "high" } },
  );
});

Deno.test("mergeConfig replaces arrays and scalars outright", () => {
  assertEquals(
    mergeConfig({ kanban: { defaultStatuses: [{ name: "A" }, { name: "B" }] } }, {
      kanban: { defaultStatuses: [{ name: "C" }] },
    }),
    // A scope's status list is its own list, not root's with extras appended.
    { kanban: { defaultStatuses: [{ name: "C" }] } },
  );
  assertEquals(mergeConfig({ a: 1 }, { a: 2 }), { a: 2 });
});

Deno.test("mergeConfig treats a null override as no override", () => {
  assertEquals(mergeConfig({ a: 1 }, null), { a: 1 });
  assertEquals(mergeConfig(null, { a: 1 }), { a: 1 });
  assertEquals(mergeConfig(null, null), null);
});

Deno.test("a scope with no config of its own resolves to root's", async () => {
  await withTempHome(async () => {
    await writeScopeConfig(ROOT, { chat: { defaultModel: "root-model" } });
    assertEquals(await resolveScopeConfig("ws-1"), { chat: { defaultModel: "root-model" } });
    // Its OWN config is still empty — inheritance is resolution, not copying.
    assertEquals(await readScopeConfig("ws-1"), null);
  });
});

Deno.test("a workspace overrides one field and inherits the rest", async () => {
  await withTempHome(async () => {
    await writeScopeConfig(ROOT, {
      chat: { defaultProvider: "lmstudio", defaultModel: "root-model" },
    });
    await writeScopeConfig("ws-1", { chat: { defaultModel: "ws-model" } });

    assertEquals(await resolveScopeConfig("ws-1"), {
      chat: { defaultProvider: "lmstudio", defaultModel: "ws-model" },
    });
    // Root is untouched by what the workspace pinned.
    assertEquals(await resolveScopeConfig(ROOT), {
      chat: { defaultProvider: "lmstudio", defaultModel: "root-model" },
    });
  });
});

Deno.test("root resolves to its own config alone", async () => {
  await withTempHome(async () => {
    await writeScopeConfig("ws-1", { chat: { defaultModel: "ws-model" } });
    // Nothing a workspace sets can reach root.
    assertEquals(await resolveScopeConfig(ROOT), null);
  });
});

Deno.test("a corrupt config file reads as null rather than throwing", async () => {
  await withTempHome(async () => {
    await writeScopeConfig(ROOT, { chat: { defaultModel: "root-model" } });
    await writeScopeConfig("ws-1", {}); // creates the dir, then corrupt the file
    await Deno.writeTextFile(scopeConfigPath("ws-1"), "{{{");
    // The workspace's own file is unreadable, so it falls back to inheriting.
    assertEquals(await resolveScopeConfig("ws-1"), { chat: { defaultModel: "root-model" } });
  });
});
