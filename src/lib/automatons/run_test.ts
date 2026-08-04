import { assertEquals } from "@std/assert";
import { listRuns, reconcileRuns, writeRunRecord } from "./run.ts";
import { ensureAutomatonDirs } from "./paths.ts";

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

Deno.test("a scope with no runs dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listRuns("ws-1"), []);
  });
});

Deno.test("runs are listed newest first", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "done",
      startedAt: "2026-08-04T10:00:00.000Z",
      trigger: "manual",
    });
    await writeRunRecord("ws-1", {
      id: "bbb",
      automaton: "triage",
      status: "done",
      startedAt: "2026-08-04T11:00:00.000Z",
      trigger: "manual",
    });

    assertEquals((await listRuns("ws-1")).map((r) => r.id), ["bbb", "aaa"]);
  });
});

// Decision 7: a run cannot outlive the app, so a `running` record found at startup
// describes nothing. Leaving it would show a row that never changes.
Deno.test("reconcileRuns turns a stranded running record into failed", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "running",
      startedAt: "2026-08-04T10:00:00.000Z",
      trigger: "manual",
    });

    await reconcileRuns();

    const [run] = await listRuns("ws-1");
    assertEquals(run.status, "failed");
    assertEquals(run.error, "interrupted by shutdown");
    assertEquals(typeof run.endedAt, "string");
  });
});

Deno.test("reconcileRuns leaves finished records alone", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "done",
      startedAt: "2026-08-04T10:00:00.000Z",
      endedAt: "2026-08-04T10:01:00.000Z",
      trigger: "manual",
    });

    await reconcileRuns();

    assertEquals((await listRuns("ws-1"))[0].status, "done");
  });
});

Deno.test("reconcileRuns with no scopes dir is a no-op rather than a failure", async () => {
  await withTempHome(async () => {
    await reconcileRuns();
  });
});
