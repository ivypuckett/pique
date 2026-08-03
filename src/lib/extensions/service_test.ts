import { assertEquals, assertThrows } from "@std/assert";
import {
  enableExtension,
  type Extension,
  extensionId,
  listExtensions,
  listVisibleExtensions,
  parseId,
  readExtension,
  removeExtension,
  revokeExtension,
} from "./service.ts";
import { enableLocal } from "./local.ts";
import {
  ensureExtensionDirs,
  pendingPackagePath,
  pendingPath,
} from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

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

async function seedLocal(
  scope: ScopeId,
  name: string,
  source = "// src",
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, name), source);
}

// Seed the quarantine record directly rather than fetching: listing must not care how
// the bytes got there, and this keeps the test off the network.
async function seedPendingPackage(
  scope: ScopeId,
  source: string,
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(
    pendingPackagePath(scope, source),
    JSON.stringify({ source, requestedAt: "2026-08-03T00:00:00.000Z" }),
  );
}

const summary = (list: Extension[]) =>
  list.map((e) => ({
    id: e.id,
    origin: e.origin,
    state: e.state,
    scope: e.scope,
  }));

Deno.test("ids split on the first colon, so a package source keeps its own", () => {
  assertEquals(parseId(extensionId("package", "npm:pi-crew")), {
    origin: "package",
    key: "npm:pi-crew",
  });
  assertEquals(parseId(extensionId("local", "my_ext")), {
    origin: "local",
    key: "my_ext",
  });
  assertThrows(() => parseId("my_ext"), Error, "invalid extension id");
  assertThrows(() => parseId("bogus:x"), Error, "invalid extension id");
});

Deno.test("an empty scope lists nothing of either origin", async () => {
  await withTempHome(async () => {
    assertEquals(await listExtensions("ws-1"), []);
  });
});

Deno.test("both origins appear in one list, pending before enabled", async () => {
  await withTempHome(async () => {
    await seedPendingPackage("ws-1", "npm:pi-crew");
    await seedLocal("ws-1", "mine");
    await seedLocal("ws-1", "live_one");
    await enableLocal("ws-1", "live_one");

    assertEquals(summary(await listExtensions("ws-1")), [
      {
        id: "package:npm:pi-crew",
        origin: "package",
        state: "pending",
        scope: "ws-1",
      },
      { id: "local:mine", origin: "local", state: "pending", scope: "ws-1" },
      {
        id: "local:live_one",
        origin: "local",
        state: "enabled",
        scope: "ws-1",
      },
    ]);
  });
});

Deno.test("reviewing a local extension returns the one file that would run", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "my_ext", "// the source");
    const src = await readExtension("ws-1", "local:my_ext", "pending");
    assertEquals(src.files, [{ path: "my_ext.ts", text: "// the source" }]);
    assertEquals(src.skills, []);
    assertEquals(src.truncated, false);
  });
});

Deno.test("enable and revoke move a local extension between the two states", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "my_ext");

    await enableExtension("ws-1", "local:my_ext");
    assertEquals(summary(await listExtensions("ws-1")), [
      { id: "local:my_ext", origin: "local", state: "enabled", scope: "ws-1" },
    ]);

    // Revoke returns it to review rather than deleting it.
    await revokeExtension("ws-1", "local:my_ext");
    assertEquals(summary(await listExtensions("ws-1")), [
      { id: "local:my_ext", origin: "local", state: "pending", scope: "ws-1" },
    ]);

    await removeExtension("ws-1", "local:my_ext", "pending");
    assertEquals(await listExtensions("ws-1"), []);
  });
});

Deno.test("a workspace sees root's enabled local extensions before its own", async () => {
  await withTempHome(async () => {
    await seedLocal(ROOT, "shared");
    await enableLocal(ROOT, "shared");
    await seedLocal("ws-1", "mine");

    assertEquals(summary(await listVisibleExtensions("ws-1")), [
      { id: "local:shared", origin: "local", state: "enabled", scope: ROOT },
      { id: "local:mine", origin: "local", state: "pending", scope: "ws-1" },
    ]);
  });
});

Deno.test("root's pending local extensions are not visible to a workspace", async () => {
  await withTempHome(async () => {
    await seedLocal(ROOT, "not_yet");
    assertEquals(await listVisibleExtensions("ws-1"), []);
  });
});

// The asymmetry the merged list has to be honest about: local extensions are inherited
// from root, packages are not (see docs/extensions.md).
Deno.test("root's packages are NOT inherited by a workspace", async () => {
  await withTempHome(async () => {
    await seedPendingPackage(ROOT, "npm:pi-crew");
    assertEquals(await listVisibleExtensions("ws-1"), []);
  });
});

Deno.test("a malformed pending record is skipped, not fatal", async () => {
  await withTempHome(async () => {
    await ensureExtensionDirs("ws-1");
    await Deno.writeTextFile(
      pendingPackagePath("ws-1", "npm:broken"),
      "{ not json",
    );
    await seedPendingPackage("ws-1", "npm:fine");

    assertEquals(summary(await listExtensions("ws-1")), [
      {
        id: "package:npm:fine",
        origin: "package",
        state: "pending",
        scope: "ws-1",
      },
    ]);
  });
});

Deno.test("a pending record that lost its source falls back to the filename", async () => {
  await withTempHome(async () => {
    await ensureExtensionDirs("ws-1");
    await Deno.writeTextFile(
      pendingPackagePath("ws-1", "npm:@scope/pkg"),
      "{}",
    );
    assertEquals((await listExtensions("ws-1"))[0].source, "npm:@scope/pkg");
  });
});
