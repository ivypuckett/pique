import { assertEquals } from "@std/assert";
import {
  isDue,
  scheduledTargets,
  type TickDeps,
  tickOnce,
} from "./schedule.ts";
import { listAutomatons, saveAutomaton } from "./service.ts";
import { writeJson } from "../settings/file.ts";
import type { Automaton } from "./parse.ts";

function def(name: string, extra: Partial<Automaton> = {}): Automaton {
  return {
    name,
    description: "",
    prompt: "p",
    extensions: [],
    skills: [],
    body: "",
    ...extra,
  };
}

// 2026-08-06 09:00 local, a Thursday.
const NINE = new Date(2026, 7, 6, 9, 0);

type Launched = { scope: string; name: string; cwd: string; trigger: string };

function deps(
  scopes: Record<string, Automaton[]>,
  opts: {
    running?: (scope: string, name: string) => boolean;
    cwd?: (scope: string) => string;
    launch?: () => Promise<string>;
  } = {},
): { deps: TickDeps; launched: Launched[] } {
  const launched: Launched[] = [];
  return {
    launched,
    deps: {
      targets: () =>
        Promise.resolve(
          Object.keys(scopes).map((scope) => ({
            scope,
            cwd: opts.cwd?.(scope) ?? `/proj/${scope}`,
          })),
        ),
      list: (scope) => Promise.resolve(scopes[scope] ?? []),
      running: opts.running ?? (() => false),
      launch: (o) => {
        launched.push(o);
        return opts.launch?.() ?? Promise.resolve("run-id");
      },
    },
  };
}

Deno.test("only a definition whose schedule names this minute is due", () => {
  assertEquals(isDue(def("a", { cron: "0 9 * * *" }), NINE), true);
  assertEquals(isDue(def("a", { cron: "0 10 * * *" }), NINE), false);
  // No schedule at all is the default: the Launch button, and nothing else.
  assertEquals(isDue(def("a"), NINE), false);
});

// A definition that cannot launch would be refused once a MINUTE, filling runs/ with
// identical failures nobody asked for. Its error is already on screen in the list.
Deno.test("a definition carrying an error never fires", () => {
  const broken = def("a", { cron: "0 9 * * *", error: "prompt: required" });
  assertEquals(isDue(broken, NINE), false);
});

Deno.test("a due automaton launches with trigger cron in its scope's cwd", async () => {
  const { deps: d, launched } = deps({
    root: [def("nightly", { cron: "0 9 * * *" }), def("manual-only")],
  });
  await tickOnce(NINE, d);
  assertEquals(launched, [{
    scope: "root",
    name: "nightly",
    cwd: "/proj/root",
    trigger: "cron",
  }]);
});

// Decision 1: schedules are not inherited, so `list` is asked for each scope's OWN
// definitions and a workspace does not re-fire root's.
Deno.test("each scope fires only its own definitions, in its own directory", async () => {
  const { deps: d, launched } = deps({
    root: [def("nightly", { cron: "0 9 * * *" })],
    "ws-1": [def("local", { cron: "0 9 * * *" })],
  });
  await tickOnce(NINE, d);
  assertEquals(launched.map((l) => `${l.scope}/${l.name}@${l.cwd}`), [
    "root/nightly@/proj/root",
    "ws-1/local@/proj/ws-1",
  ]);
});

// Decision 2. The alternative — launching anyway — compounds without bound when a job
// takes longer than its interval.
Deno.test("a fire is dropped while the previous run is still going", async () => {
  const { deps: d, launched } = deps(
    { root: [def("slow", { cron: "* * * * *" })] },
    { running: (_s, name) => name === "slow" },
  );
  await tickOnce(NINE, d);
  assertEquals(launched, []);
});

// Same automaton NAME in two scopes is two automatons; one being busy must not silence
// the other.
Deno.test("the busy check is per scope, not per name", async () => {
  const { deps: d, launched } = deps(
    {
      root: [def("triage", { cron: "* * * * *" })],
      "ws-1": [def("triage", { cron: "* * * * *" })],
    },
    { running: (scope) => scope === "root" },
  );
  await tickOnce(NINE, d);
  assertEquals(launched.map((l) => l.scope), ["ws-1"]);
});

// The tick runs detached on a timer, so anything escaping it is an unhandled rejection.
Deno.test("a refused launch does not stop the rest of the minute", async () => {
  const { deps: d, launched } = deps(
    {
      root: [
        def("broken", { cron: "* * * * *" }),
        def("fine", { cron: "* * * * *" }),
      ],
    },
    {
      launch: () => Promise.reject(new Error("extension not found: nope")),
    },
  );
  await tickOnce(NINE, d);
  // Both were attempted; the first one's refusal was recorded by launchAutomaton itself.
  assertEquals(launched.map((l) => l.name), ["broken", "fine"]);
});

Deno.test("a scope that cannot be listed does not stop the others", async () => {
  const { deps: d, launched } = deps({
    root: [def("nightly", { cron: "* * * * *" })],
    "ws-1": [],
  });
  const failing: TickDeps = {
    ...d,
    list: (scope) =>
      scope === "ws-1"
        ? Promise.reject(new Error("permission denied"))
        : d.list(scope),
  };
  await tickOnce(NINE, failing);
  assertEquals(launched.map((l) => l.name), ["nightly"]);
});

// End-to-end over real files: a definition on disk, a real saved layout, the real
// listing and target resolution. Only the launch itself is stubbed — everything the
// scheduler decides from is what pique would actually read at 09:00.
Deno.test("a tick reads real definitions and the real layout", async () => {
  const prev = Deno.env.get("HOME");
  const home = await Deno.makeTempDir();
  Deno.env.set("HOME", home);
  try {
    await writeJson("layout", {
      root: { id: "root", cwd: "/proj/root" },
      workspaces: [{ id: "ws-1" }],
      activeId: "root",
    });
    await saveAutomaton("root", "nightly", {
      description: "",
      prompt: "daily",
      extensions: [],
      skills: [],
      cron: "0 9 * * *",
    });
    await saveAutomaton("root", "hourly", {
      description: "",
      prompt: "hourly",
      extensions: [],
      skills: [],
      cron: "0 10 * * *",
    });
    // A workspace with no cwd of its own inherits root's, exactly as a module does.
    await saveAutomaton("ws-1", "local", {
      description: "",
      prompt: "local",
      extensions: [],
      skills: [],
      cron: "0 9 * * *",
    });
    // ws-9 exists on disk but not in the layout — a closed workspace. Its schedule must
    // not fire into a directory the user believes is gone.
    await saveAutomaton("ws-9", "ghost", {
      description: "",
      prompt: "ghost",
      extensions: [],
      skills: [],
      cron: "* * * * *",
    });

    const launched: Launched[] = [];
    await tickOnce(NINE, {
      targets: scheduledTargets,
      list: listAutomatons,
      running: () => false,
      launch: (o) => {
        launched.push(o);
        return Promise.resolve("run-id");
      },
    });
    assertEquals(launched, [
      { scope: "root", name: "nightly", cwd: "/proj/root", trigger: "cron" },
      { scope: "ws-1", name: "local", cwd: "/proj/root", trigger: "cron" },
    ]);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});
