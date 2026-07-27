import { assertEquals, assertRejects } from "@std/assert";
import { approveTool, listTools, readSource, rejectTool, revokeTool } from "./service.ts";
import { ensureToolDirs, liveDir, livePath, pendingPath } from "./paths.ts";

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

async function seedPending(name: string, source: string): Promise<void> {
  await ensureToolDirs();
  await Deno.writeTextFile(pendingPath(name), source);
}

Deno.test("listTools reports nothing before anything is defined", async () => {
  await withTempHome(async () => {
    assertEquals(await listTools(), []);
  });
});

Deno.test("approve moves quarantine into the auto-discovered dir", async () => {
  await withTempHome(async () => {
    await seedPending("my_tool", "// src");
    assertEquals(await listTools(), [{ name: "my_tool", state: "pending" }]);
    // Still quarantined: nothing in the dir pi actually loads.
    assertEquals([...Deno.readDirSync(liveDir())].length, 0);

    await approveTool("my_tool");
    assertEquals(await listTools(), [{ name: "my_tool", state: "approved" }]);
    assertEquals(await Deno.readTextFile(livePath("my_tool")), "// src");
  });
});

Deno.test("re-approving a redefinition supersedes the live copy", async () => {
  await withTempHome(async () => {
    await seedPending("my_tool", "// v1");
    await approveTool("my_tool");
    await seedPending("my_tool", "// v2");
    await approveTool("my_tool");

    assertEquals(await listTools(), [{ name: "my_tool", state: "approved" }]);
    assertEquals(await readSource("my_tool", "approved"), "// v2");
  });
});

Deno.test("reject and revoke remove the file from their dir", async () => {
  await withTempHome(async () => {
    await seedPending("gone", "// src");
    await rejectTool("gone");
    assertEquals(await listTools(), []);

    await seedPending("live_one", "// src");
    await approveTool("live_one");
    await revokeTool("live_one");
    assertEquals(await listTools(), []);
  });
});

Deno.test("service refuses names that would escape the tool dirs", async () => {
  await withTempHome(async () => {
    await assertRejects(() => approveTool("../evil"), Error, "invalid tool name");
    await assertRejects(() => readSource("a/b", "pending"), Error, "invalid tool name");
  });
});
