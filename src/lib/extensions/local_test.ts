import { assertEquals, assertRejects } from "@std/assert";
import {
  enableLocal,
  inheritedExtensionFiles,
  listLocal,
  listVisibleLocal,
  readLocalSource,
  removeLocal,
  revokeLocal,
} from "./local.ts";
import {
  ensureExtensionDirs,
  liveDir,
  livePath,
  pendingDir,
  pendingPath,
} from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// Point HOME at a throwaway dir so the service reads/writes under a temp tree,
// mirroring kanban's service tests.
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

async function seedPending(
  scope: ScopeId,
  name: string,
  source: string,
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, name), source);
}

Deno.test("listLocal reports nothing before anything is defined", async () => {
  await withTempHome(async () => {
    assertEquals(await listLocal("ws-1"), []);
  });
});

Deno.test("enable moves quarantine into the auto-discovered dir", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "my_ext", "// src");
    assertEquals(await listLocal("ws-1"), [
      { name: "my_ext", state: "pending", scope: "ws-1" },
    ]);
    // Still quarantined: nothing in the dir pi actually loads.
    assertEquals([...Deno.readDirSync(liveDir("ws-1"))].length, 0);

    await enableLocal("ws-1", "my_ext");
    assertEquals(await listLocal("ws-1"), [
      { name: "my_ext", state: "enabled", scope: "ws-1" },
    ]);
    assertEquals(await Deno.readTextFile(livePath("ws-1", "my_ext")), "// src");
  });
});

Deno.test("an extension enabled in one workspace does not leak into another", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "mine", "// src");
    await enableLocal("ws-1", "mine");

    assertEquals(await listLocal("ws-2"), []);
    assertEquals(await listVisibleLocal("ws-2"), []);
    assertEquals(await inheritedExtensionFiles("ws-2"), []);
  });
});

Deno.test("an extension enabled in root is visible from every workspace", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "shared", "// src");
    await enableLocal(ROOT, "shared");

    // Root's own list is unchanged by what workspaces hold.
    assertEquals(await listLocal(ROOT), [{
      name: "shared",
      state: "enabled",
      scope: ROOT,
    }]);
    // The workspace owns nothing, but sees root's.
    assertEquals(await listLocal("ws-1"), []);
    assertEquals(await listVisibleLocal("ws-1"), [
      { name: "shared", state: "enabled", scope: ROOT },
    ]);
    assertEquals(await inheritedExtensionFiles("ws-1"), [
      livePath(ROOT, "shared"),
    ]);
  });
});

Deno.test("root inherits nothing — it cannot see a workspace's extensions", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "local_one", "// src");
    await enableLocal("ws-1", "local_one");

    assertEquals(await inheritedExtensionFiles(ROOT), []);
    assertEquals(await listVisibleLocal(ROOT), []);
  });
});

Deno.test("only enabled extensions are inherited — quarantine stays put", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "not_yet", "// src");
    assertEquals(await inheritedExtensionFiles("ws-1"), []);
  });
});

Deno.test("a workspace's visible extensions list its own after root's", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "shared", "// src");
    await enableLocal(ROOT, "shared");
    await seedPending("ws-1", "mine", "// src");
    await enableLocal("ws-1", "mine");

    assertEquals(await listVisibleLocal("ws-1"), [
      { name: "shared", state: "enabled", scope: ROOT },
      { name: "mine", state: "enabled", scope: "ws-1" },
    ]);
  });
});

Deno.test("re-enabling a redefinition supersedes the live copy", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "my_ext", "// v1");
    await enableLocal("ws-1", "my_ext");
    await seedPending("ws-1", "my_ext", "// v2");
    await enableLocal("ws-1", "my_ext");

    assertEquals(await listLocal("ws-1"), [{
      name: "my_ext",
      state: "enabled",
      scope: "ws-1",
    }]);
    assertEquals(await readLocalSource("ws-1", "my_ext", "enabled"), "// v2");
  });
});

Deno.test("the same name can be defined independently in two scopes", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "dup", "// root version");
    await enableLocal(ROOT, "dup");
    await seedPending("ws-1", "dup", "// workspace version");
    await enableLocal("ws-1", "dup");

    assertEquals(
      await readLocalSource(ROOT, "dup", "enabled"),
      "// root version",
    );
    assertEquals(
      await readLocalSource("ws-1", "dup", "enabled"),
      "// workspace version",
    );
  });
});

// Revoke is non-destructive: it returns the module to quarantine, so re-enabling it is
// a re-review rather than a silent restore.
Deno.test("revoke returns an enabled extension to quarantine, keeping its source", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "live_one", "// src");
    await enableLocal("ws-1", "live_one");
    await revokeLocal("ws-1", "live_one");

    assertEquals(await listLocal("ws-1"), [{
      name: "live_one",
      state: "pending",
      scope: "ws-1",
    }]);
    assertEquals([...Deno.readDirSync(liveDir("ws-1"))].length, 0);
    assertEquals(
      await readLocalSource("ws-1", "live_one", "pending"),
      "// src",
    );
  });
});

Deno.test("revoking in root withdraws the extension from workspaces too", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "shared", "// src");
    await enableLocal(ROOT, "shared");
    await revokeLocal(ROOT, "shared");
    assertEquals(await inheritedExtensionFiles("ws-1"), []);
  });
});

Deno.test("remove deletes from whichever dir the extension is in", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "gone", "// src");
    await removeLocal("ws-1", "gone", "pending");
    assertEquals(await listLocal("ws-1"), []);

    await seedPending("ws-1", "live_one", "// src");
    await enableLocal("ws-1", "live_one");
    await removeLocal("ws-1", "live_one", "enabled");
    assertEquals(await listLocal("ws-1"), []);
  });
});

// The pending dir holds both origins; the local half must ignore the package half.
Deno.test("a pending package's json is not mistaken for a local extension", async () => {
  await withTempHome(async () => {
    await ensureExtensionDirs("ws-1");
    await Deno.writeTextFile(
      `${pendingDir("ws-1")}/npm%3Api-crew.json`,
      JSON.stringify({ source: "npm:pi-crew" }),
    );
    assertEquals(await listLocal("ws-1"), []);
  });
});

Deno.test("service refuses names and scopes that would escape the extension dirs", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => enableLocal("ws-1", "../evil"),
      Error,
      "invalid extension name",
    );
    await assertRejects(
      () => readLocalSource("ws-1", "a/b", "pending"),
      Error,
      "invalid extension name",
    );
    await assertRejects(() => listLocal("../evil"), Error, "invalid scope id");
  });
});
