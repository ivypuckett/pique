import { assertEquals, assertRejects } from "@std/assert";
import {
  approveTool,
  inheritedExtensionFiles,
  listTools,
  listVisibleTools,
  readSource,
  rejectTool,
  revokeTool,
} from "./service.ts";
import { ensureToolDirs, liveDir, livePath, pendingPath } from "./paths.ts";
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

async function seedPending(scope: ScopeId, name: string, source: string): Promise<void> {
  await ensureToolDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, name), source);
}

Deno.test("listTools reports nothing before anything is defined", async () => {
  await withTempHome(async () => {
    assertEquals(await listTools("ws-1"), []);
  });
});

Deno.test("approve moves quarantine into the auto-discovered dir", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "my_tool", "// src");
    assertEquals(await listTools("ws-1"), [
      { name: "my_tool", state: "pending", scope: "ws-1" },
    ]);
    // Still quarantined: nothing in the dir pi actually loads.
    assertEquals([...Deno.readDirSync(liveDir("ws-1"))].length, 0);

    await approveTool("ws-1", "my_tool");
    assertEquals(await listTools("ws-1"), [
      { name: "my_tool", state: "approved", scope: "ws-1" },
    ]);
    assertEquals(await Deno.readTextFile(livePath("ws-1", "my_tool")), "// src");
  });
});

Deno.test("a tool approved in one workspace does not leak into another", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "mine", "// src");
    await approveTool("ws-1", "mine");

    assertEquals(await listTools("ws-2"), []);
    assertEquals(await listVisibleTools("ws-2"), []);
    assertEquals(await inheritedExtensionFiles("ws-2"), []);
  });
});

Deno.test("a tool approved in root is visible from every workspace", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "shared", "// src");
    await approveTool(ROOT, "shared");

    // Root's own list is unchanged by what workspaces hold.
    assertEquals(await listTools(ROOT), [
      { name: "shared", state: "approved", scope: ROOT },
    ]);
    // The workspace owns nothing, but sees root's.
    assertEquals(await listTools("ws-1"), []);
    assertEquals(await listVisibleTools("ws-1"), [
      { name: "shared", state: "approved", scope: ROOT },
    ]);
    assertEquals(await inheritedExtensionFiles("ws-1"), [livePath(ROOT, "shared")]);
  });
});

Deno.test("root inherits nothing — it cannot see a workspace's tools", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "local", "// src");
    await approveTool("ws-1", "local");

    assertEquals(await inheritedExtensionFiles(ROOT), []);
    assertEquals(await listVisibleTools(ROOT), []);
  });
});

Deno.test("only approved tools are inherited — quarantine stays put", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "not_yet", "// src");
    assertEquals(await inheritedExtensionFiles("ws-1"), []);
  });
});

Deno.test("a workspace's visible tools list its own after root's", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "shared", "// src");
    await approveTool(ROOT, "shared");
    await seedPending("ws-1", "mine", "// src");
    await approveTool("ws-1", "mine");

    assertEquals(await listVisibleTools("ws-1"), [
      { name: "shared", state: "approved", scope: ROOT },
      { name: "mine", state: "approved", scope: "ws-1" },
    ]);
  });
});

Deno.test("re-approving a redefinition supersedes the live copy", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "my_tool", "// v1");
    await approveTool("ws-1", "my_tool");
    await seedPending("ws-1", "my_tool", "// v2");
    await approveTool("ws-1", "my_tool");

    assertEquals(await listTools("ws-1"), [
      { name: "my_tool", state: "approved", scope: "ws-1" },
    ]);
    assertEquals(await readSource("ws-1", "my_tool", "approved"), "// v2");
  });
});

Deno.test("the same name can be defined independently in two scopes", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "dup", "// root version");
    await approveTool(ROOT, "dup");
    await seedPending("ws-1", "dup", "// workspace version");
    await approveTool("ws-1", "dup");

    assertEquals(await readSource(ROOT, "dup", "approved"), "// root version");
    assertEquals(await readSource("ws-1", "dup", "approved"), "// workspace version");
  });
});

Deno.test("reject and revoke remove the file from their dir", async () => {
  await withTempHome(async () => {
    await seedPending("ws-1", "gone", "// src");
    await rejectTool("ws-1", "gone");
    assertEquals(await listTools("ws-1"), []);

    await seedPending("ws-1", "live_one", "// src");
    await approveTool("ws-1", "live_one");
    await revokeTool("ws-1", "live_one");
    assertEquals(await listTools("ws-1"), []);
  });
});

Deno.test("revoking in root withdraws the tool from workspaces too", async () => {
  await withTempHome(async () => {
    await seedPending(ROOT, "shared", "// src");
    await approveTool(ROOT, "shared");
    await revokeTool(ROOT, "shared");
    assertEquals(await inheritedExtensionFiles("ws-1"), []);
  });
});

Deno.test("service refuses names and scopes that would escape the tool dirs", async () => {
  await withTempHome(async () => {
    await assertRejects(() => approveTool("ws-1", "../evil"), Error, "invalid tool name");
    await assertRejects(() => readSource("ws-1", "a/b", "pending"), Error, "invalid tool name");
    await assertRejects(() => listTools("../evil"), Error, "invalid scope id");
  });
});
