import { assertEquals, assertRejects } from "@std/assert";
import {
  deleteAutomaton,
  listAutomatons,
  listVisibleAutomatons,
  resolveAutomaton,
  saveAutomaton,
} from "./service.ts";
import { automatonPath, ensureAutomatonDirs, pendingDir } from "./paths.ts";
import type { ScopeId } from "../scope/paths.ts";

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

async function write(
  scope: ScopeId,
  name: string,
  text: string,
): Promise<void> {
  await ensureAutomatonDirs(scope);
  await Deno.writeTextFile(automatonPath(scope, name), text);
}

Deno.test("a scope with no automatons dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listAutomatons("ws-1"), []);
  });
});

Deno.test("automatons are listed with their scope", async () => {
  await withTempHome(async () => {
    await write("ws-1", "triage", "---\nprompt: p\n---\n");

    const [a] = await listAutomatons("ws-1");
    assertEquals(a.name, "triage");
    assertEquals(a.scope, "ws-1");
  });
});

// The quarantine dir is created by ensureAutomatonDirs but nothing writes to it yet.
// This pins that a file placed there by hand is never launchable.
Deno.test("a file in pending/ is never listed as live", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await Deno.writeTextFile(
      `${pendingDir("ws-1")}/sneaky.md`,
      "---\nprompt: p\n---\n",
    );

    assertEquals(await listAutomatons("ws-1"), []);
    assertEquals(await resolveAutomaton("ws-1", "sneaky"), undefined);
  });
});

Deno.test("a workspace sees root's automatons and its own, nearest name winning", async () => {
  await withTempHome(async () => {
    await write("root", "shared", "---\nprompt: from-root\n---\n");
    await write("root", "overridden", "---\nprompt: from-root\n---\n");
    await write("ws-1", "overridden", "---\nprompt: from-ws\n---\n");

    const byName = new Map(
      (await listVisibleAutomatons("ws-1")).map((a) => [a.name, a.prompt]),
    );
    assertEquals(byName.get("shared"), "from-root");
    assertEquals(byName.get("overridden"), "from-ws");
    assertEquals(byName.size, 2);
  });
});

Deno.test("resolveAutomaton prefers the nearest scope", async () => {
  await withTempHome(async () => {
    await write("root", "shared", "---\nprompt: from-root\n---\n");
    await write("ws-1", "shared", "---\nprompt: from-ws\n---\n");

    assertEquals((await resolveAutomaton("ws-1", "shared"))?.prompt, "from-ws");
    assertEquals(
      (await resolveAutomaton("root", "shared"))?.prompt,
      "from-root",
    );
  });
});

Deno.test("save then delete round-trips", async () => {
  await withTempHome(async () => {
    await saveAutomaton("ws-1", "triage", {
      description: "d",
      prompt: "daily-triage",
      extensions: ["pique:kanban"],
      skills: [],
    });
    assertEquals((await resolveAutomaton("ws-1", "triage"))?.extensions, [
      "pique:kanban",
    ]);

    await deleteAutomaton("ws-1", "triage");
    assertEquals(await resolveAutomaton("ws-1", "triage"), undefined);
  });
});

Deno.test("an illegal name is rejected on save", async () => {
  await withTempHome(async () => {
    await assertRejects(() =>
      saveAutomaton("ws-1", "../escape", {
        description: "",
        prompt: "p",
        extensions: [],
        skills: [],
      })
    );
  });
});

Deno.test("a stray file with an illegal basename is skipped, not fatal", async () => {
  await withTempHome(async () => {
    await write("ws-1", "triage", "---\nprompt: p\n---\n");
    await Deno.writeTextFile(
      automatonPath("ws-1", "triage").replace("triage.md", "Not A Name.md"),
      "---\nprompt: p\n---\n",
    );

    assertEquals((await listAutomatons("ws-1")).map((a) => a.name), ["triage"]);
  });
});

// `tools` absent and `tools: []` are semantically different (unrestricted vs. no
// builtins) and must not collapse into each other on the way through write+read. This
// only covers saveAutomaton/parse.ts — it does not reach the automatonsSave win.bind
// handler in desktop.ts, which is separate, untestable here, and where the actual bug
// (`tools` silently dropped) lived.
Deno.test("saveAutomaton round-trips an empty tools restriction", async () => {
  await withTempHome(async () => {
    await saveAutomaton("root", "restricted", {
      description: "",
      prompt: "p",
      extensions: [],
      skills: [],
      tools: [],
    });
    const [a] = await listAutomatons("root");
    assertEquals(a.tools, []);
  });
});

Deno.test("saveAutomaton round-trips an absent tools restriction as unrestricted", async () => {
  await withTempHome(async () => {
    await saveAutomaton("root", "unrestricted", {
      description: "",
      prompt: "p",
      extensions: [],
      skills: [],
    });
    const [a] = await listAutomatons("root");
    assertEquals(a.tools, undefined);
  });
});

// A file that namesIn() saw but that is gone by the time it is read (deleted from
// another tab, or by an agent run) must not take down the whole listing — same
// tolerance as an illegal basename or a missing dir. A real filesystem race is too
// timing-dependent to trigger reliably, so this simulates it: readTextFile is
// patched to report NotFound for one specific, already-listed name.
Deno.test("a file that vanishes between listing and reading is dropped, not fatal", async () => {
  await withTempHome(async () => {
    await write("ws-1", "triage", "---\nprompt: p\n---\n");
    await write("ws-1", "vanishing", "---\nprompt: p\n---\n");

    const original = Deno.readTextFile;
    Deno.readTextFile = ((path: string | URL, opts?: Deno.ReadFileOptions) => {
      if (String(path).endsWith("vanishing.md")) {
        return Promise.reject(new Deno.errors.NotFound("simulated race"));
      }
      return original(path, opts);
    }) as typeof Deno.readTextFile;
    try {
      assertEquals((await listAutomatons("ws-1")).map((a) => a.name), [
        "triage",
      ]);
    } finally {
      Deno.readTextFile = original;
    }
  });
});
