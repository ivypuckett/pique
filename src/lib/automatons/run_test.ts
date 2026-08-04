import { assertEquals, assertRejects } from "@std/assert";
import {
  launchAutomaton,
  listRuns,
  reconcileRuns,
  runHistory,
  writeRunRecord,
} from "./run.ts";
import { ensureAutomatonDirs, runsDir, sessionsDir } from "./paths.ts";
import { saveAutomaton } from "./service.ts";
import { scopeDir, scopesDir } from "../scope/paths.ts";

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

// reconcileRuns runs at boot, so a scope it cannot read must not take the others down
// with it — nor the app. A `runs/` that is a regular file is the cheap way to provoke
// the NotADirectory that listRuns rethrows.
Deno.test("one unreadable scope does not stop reconcileRuns repairing the rest", async () => {
  await withTempHome(async () => {
    await Deno.mkdir(`${scopeDir("ws-1")}/automatons`, { recursive: true });
    await Deno.writeTextFile(runsDir("ws-1"), "not a directory");

    await ensureAutomatonDirs("ws-2");
    await writeRunRecord("ws-2", {
      id: "aaa",
      automaton: "triage",
      status: "running",
      startedAt: "2026-08-04T10:00:00.000Z",
      trigger: "cron",
    });

    await reconcileRuns();

    assertEquals((await listRuns("ws-2"))[0].status, "failed");
  });
});

// The record is the only durable statement of what a run did, and listRuns skips what
// it cannot parse — so a half-written one would be invisible to the UI AND to
// reconcileRuns. The write goes through a temp file; this pins that it does not leave
// one lying around.
Deno.test("writing a record is atomic and leaves no temp file behind", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "done",
      startedAt: "2026-08-04T10:00:00.000Z",
      trigger: "manual",
      sessionFile: "/tmp/session.jsonl",
    });

    const names: string[] = [];
    for await (const entry of Deno.readDir(runsDir("ws-1"))) {
      names.push(entry.name);
    }
    assertEquals(names, ["aaa.json"]);
    // sessionFile round-trips: it is what makes a finished run's transcript readable.
    assertEquals((await listRuns("ws-1"))[0].sessionFile, "/tmp/session.jsonl");
  });
});

// A launch refused before any session exists still owes the run list a row. This is the
// path an unattended trigger depends on — it has nobody to throw at.
Deno.test("a launch refused for an unknown automaton throws AND records why", async () => {
  await withTempHome(async () => {
    await Deno.mkdir(scopesDir(), { recursive: true });

    await assertRejects(
      () => launchAutomaton({ scope: "ws-1", name: "nope", cwd: "/tmp" }),
      Error,
      "automaton not found: nope",
    );

    const [run] = await listRuns("ws-1");
    assertEquals(run.status, "failed");
    assertEquals(run.automaton, "nope");
    assertEquals(run.error, "automaton not found: nope");
    assertEquals(run.trigger, "manual");
    assertEquals(typeof run.endedAt, "string");
  });
});

// Reachable as a unit test only because the loader and this check sit ABOVE
// ensureRuntime(): no model is involved in deciding that `prompt:` names nothing.
// pi's expander returns the text unchanged when no template matches, so without this
// check the run would start and send the model the literal string `/nosuchtemplate`.
Deno.test("an automaton whose prompt names no template is refused before a session exists", async () => {
  await withTempHome(async () => {
    const cwd = await Deno.makeTempDir();
    try {
      await saveAutomaton("ws-1", "triage", {
        description: "",
        prompt: "nosuchtemplate",
        extensions: [],
        skills: [],
      });

      await assertRejects(
        () => launchAutomaton({ scope: "ws-1", name: "triage", cwd }),
        Error,
        'prompt template not found: "nosuchtemplate"',
      );

      const [run] = await listRuns("ws-1");
      assertEquals(run.status, "failed");
      assertEquals(run.error, 'prompt template not found: "nosuchtemplate"');
      // Refused before createAgentSession, so no session file was ever opened for it.
      assertEquals(
        await Array.fromAsync(Deno.readDir(sessionsDir("ws-1"))),
        [],
      );
    } finally {
      await Deno.remove(cwd, { recursive: true });
    }
  });
});

Deno.test("runHistory of a run with no session file is empty, not an error", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "failed",
      startedAt: "2026-08-04T10:00:00.000Z",
      trigger: "manual",
    });

    assertEquals(await runHistory("ws-1", "aaa"), []);
    assertEquals(await runHistory("ws-1", "nosuchrun"), []);
  });
});
