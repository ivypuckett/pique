import { assertEquals } from "@std/assert";
import {
  dispatchArrival,
  type DispatchDeps,
  pendingCards,
  watches,
} from "./kanban.ts";
import type { Automaton } from "./parse.ts";
import type { CardArrival } from "../kanban/board.ts";

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

function arrival(extra: Partial<CardArrival> = {}): CardArrival {
  return {
    cardId: "card-1",
    title: "Fix the login bug",
    statusId: "st-1",
    statusName: "In Progress",
    ...extra,
  };
}

type Launched = {
  scope: string;
  name: string;
  cwd: string;
  args?: string;
  card?: string;
  trigger?: string;
};

// A fake app. `running` is the live-run map: the fake launch adds to it, and a test ends
// a run by removing the card and calling the `onEnd` that launch captured — which is
// exactly what run.ts's finish() does.
function deps(
  defs: Automaton[],
  opts: {
    cwd?: string | undefined;
    live?: (scope: string, name: string) => string[];
    columnOf?: (scope: string, cardId: string) => Promise<string | undefined>;
    // Approved by default, so every test here goes on asking what it already asked —
    // which arrivals fire what, and how the slots work. The gate has its own tests.
    approved?: (scope: string, a: Automaton) => boolean;
  } = {},
): {
  deps: DispatchDeps;
  launched: Launched[];
  running: string[];
  endAll: () => Promise<void>;
} {
  const launched: Launched[] = [];
  const running: string[] = [];
  const ends: (() => void)[] = [];
  return {
    launched,
    running,
    // End every run that is going: empty the live map, then fire each captured handler
    // and let the async drain it starts settle.
    endAll: async () => {
      running.length = 0;
      for (const end of ends.splice(0, ends.length)) end();
      await new Promise((r) => setTimeout(r, 0));
    },
    deps: {
      list: () => Promise.resolve(defs),
      approved: (scope, a) =>
        Promise.resolve(opts.approved?.(scope, a) ?? true),
      cwd: () => Promise.resolve("cwd" in opts ? opts.cwd : "/proj/root"),
      live: opts.live ?? (() => running),
      columnOf: opts.columnOf ?? (() => Promise.resolve("In Progress")),
      launch: (o) => {
        const { onEnd, ...rest } = o;
        launched.push(rest);
        // Mirrors run.ts's liveRunsOf, which reports CARD runs only: a run the Launch
        // button or a cron started is not in the live list at all.
        if (o.card !== undefined) running.push(o.card);
        if (onEnd) ends.push(onEnd);
        return Promise.resolve("run-id");
      },
    },
  };
}

Deno.test("a column name matches case- and whitespace-insensitively", () => {
  assertEquals(
    watches(def("a", { kanban: "In Progress" }), "in progress"),
    true,
  );
  assertEquals(watches(def("a", { kanban: "  Doing " }), "Doing"), true);
  assertEquals(watches(def("a", { kanban: "Doing" }), "Done"), false);
  // No key at all is the default: no card fires it.
  assertEquals(watches(def("a"), "Doing"), false);
});

// Its `kanban:` may be the broken part, and a launch would be refused anyway — once per
// arrival, filling runs/ with identical failures. Same rule cron follows.
Deno.test("a definition carrying an error never fires", () => {
  const broken = def("a", { kanban: "In Progress", error: "prompt: required" });
  assertEquals(watches(broken, "In Progress"), false);
});

Deno.test("an arrival launches the watcher with the card id and title", async () => {
  const { deps: d, launched } = deps([
    def("worker", { kanban: "In Progress" }),
    def("other", { kanban: "Done" }),
  ]);
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched, [{
    scope: "root",
    name: "worker",
    cwd: "/proj/root",
    args: `card-1 "Fix the login bug"`,
    card: "card-1",
    trigger: "kanban",
  }]);
});

// docs/security.md finding 1. A card arriving is not a human pressing Launch — decision
// 5 is that AGENT moves fire too, so without this an agent could write a definition
// watching a column and then move a card into it, firing itself.
Deno.test("an arrival for an automaton nobody approved does not fire", async () => {
  const { deps: d, launched } = deps(
    [def("worker", { kanban: "In Progress" })],
    { approved: () => false },
  );
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched, []);
});

// The gate sits where the arrival path and the drain path converge, so an approval
// withdrawn while cards waited is honoured when the slot frees rather than only on
// arrival.
// Uses its own name, per the queueing convention noted below.
Deno.test("approval revoked while a card waits stops the drain", async () => {
  let approved = true;
  const { deps: d, launched, endAll } = deps(
    [def("queued-10", { kanban: "In Progress", wip: 1 })],
    { approved: () => approved },
  );
  await dispatchArrival("root", arrival({ cardId: "card-1" }), d);
  await dispatchArrival("root", arrival({ cardId: "card-2" }), d);
  assertEquals(launched.map((l) => l.card), ["card-1"]);
  assertEquals(pendingCards("root", "queued-10"), ["card-2"]);

  approved = false;
  await endAll();
  assertEquals(launched.map((l) => l.card), ["card-1"]);
  // Drained rather than stranded: the card came off the queue, was refused, and left
  // nothing behind for the next test sharing this module's state.
  assertEquals(pendingCards("root", "queued-10"), []);
});

// The card is already being worked by that automaton; a second run would duplicate the
// work rather than continue it.
Deno.test("the same card while that automaton runs it is dropped", async () => {
  const { deps: d, launched } = deps(
    [def("worker", { kanban: "In Progress" })],
    { live: () => ["card-1"] },
  );
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched, []);
});

Deno.test("a different card is not blocked by a running one", async () => {
  const { deps: d, launched } = deps(
    [def("worker", { kanban: "In Progress" })],
    { live: () => ["card-9"] },
  );
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched.length, 1);
  assertEquals(launched[0].card, "card-1");
});

// Absent `wip:` is unlimited, which is what "a run per card" plainly means.
Deno.test("without wip: an arrival launches however many are already running", async () => {
  const { deps: d, launched } = deps(
    [def("worker", { kanban: "In Progress" })],
    { live: () => ["a", "b", "c", "d"] },
  );
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched.length, 1);
});

// Every queueing test below uses a DISTINCT automaton name (`queued-1`…`queued-9`), and
// new ones must too. The queue is module state keyed by scope and name, and a test that
// leaves a card behind — as this one deliberately does — would otherwise be read as
// arrivals by the next test sharing its name.
Deno.test("a fire at the wip limit is queued, not dropped", async () => {
  const { deps: d, launched } = deps(
    [def("queued-1", { kanban: "In Progress", wip: 1 })],
  );
  // The first card fills the only slot.
  await dispatchArrival("root", arrival({ cardId: "card-9" }), d);
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched.map((l) => l.card), ["card-9"]);
  assertEquals(pendingCards("root", "queued-1"), ["card-1"]);
});

Deno.test("the queue dedupes by card", async () => {
  const { deps: d } = deps(
    [def("queued-2", { kanban: "In Progress", wip: 1 })],
  );
  await dispatchArrival("root", arrival({ cardId: "card-9" }), d);
  await dispatchArrival("root", arrival(), d);
  await dispatchArrival("root", arrival(), d);
  await dispatchArrival("root", arrival({ cardId: "card-2" }), d);
  assertEquals(pendingCards("root", "queued-2"), ["card-1", "card-2"]);
});

// The point of having waited. A card a human pulled back out of the column must not be
// worked ten minutes later because it was sitting in a queue.
Deno.test("a queued card that left the column is dropped when the queue drains", async () => {
  const { deps: d, launched, endAll } = deps(
    [def("queued-3", { kanban: "In Progress", wip: 1 })],
    {
      columnOf: (_s, cardId) =>
        Promise.resolve(cardId === "card-1" ? "Done" : "In Progress"),
    },
  );
  await dispatchArrival("root", arrival({ cardId: "card-9" }), d);
  await dispatchArrival("root", arrival(), d);
  await dispatchArrival("root", arrival({ cardId: "card-2" }), d);
  assertEquals(pendingCards("root", "queued-3"), ["card-1", "card-2"]);
  launched.length = 0;
  await endAll();
  // card-1 moved to Done and is dropped; the slot it would have taken goes to card-2.
  assertEquals(launched.map((l) => l.card), ["card-2"]);
  assertEquals(pendingCards("root", "queued-3"), []);
});

// A queued card that was deleted is the same case as one that moved on.
Deno.test("a queued card that no longer exists is dropped when the queue drains", async () => {
  const { deps: d, launched, endAll } = deps(
    [def("queued-4", { kanban: "In Progress", wip: 1 })],
    { columnOf: () => Promise.resolve(undefined) },
  );
  await dispatchArrival("root", arrival({ cardId: "card-9" }), d);
  await dispatchArrival("root", arrival(), d);
  launched.length = 0;
  await endAll();
  assertEquals(launched, []);
  assertEquals(pendingCards("root", "queued-4"), []);
});

// The three tests below cover the "never raises" contract. dispatchArrival is called from
// a board write that has already committed, so anything escaping it is an unhandled
// rejection rather than something a caller reports — each asserts it RESOLVED.

// Mirrors schedule_test.ts's "a refused launch does not stop the rest of the minute".
Deno.test("a refused launch is logged, and the other watcher still fires", async () => {
  const { deps: d } = deps([
    def("first", { kanban: "In Progress" }),
    def("second", { kanban: "In Progress" }),
  ]);
  const attempted: string[] = [];
  const failing: DispatchDeps = {
    ...d,
    launch: (o) => {
      attempted.push(o.name);
      return Promise.reject(new Error("extension not found: nope"));
    },
  };
  assertEquals(await dispatchArrival("root", arrival(), failing), undefined);
  // Both were attempted; the first one's refusal was recorded by launchAutomaton itself.
  assertEquals(attempted, ["first", "second"]);
});

// Mirrors schedule_test.ts's "a scope that cannot be listed does not stop the others".
// One arrival concerns one scope, so there is nothing to carry on to — only the promise.
Deno.test("a scope that cannot be listed fires nothing and does not raise", async () => {
  const { deps: d, launched } = deps([
    def("worker", { kanban: "In Progress" }),
  ]);
  const failing: DispatchDeps = {
    ...d,
    list: () => Promise.reject(new Error("permission denied")),
  };
  assertEquals(await dispatchArrival("root", arrival(), failing), undefined);
  assertEquals(launched, []);
});

// The drain's own catch. It runs detached from `onEnd`, so an escaping error here would
// surface as an unhandled rejection — which is what this test would fail with.
Deno.test("a board that cannot be re-checked drops the card without raising", async () => {
  const { deps: d, launched, endAll } = deps(
    [def("queued-5", { kanban: "In Progress", wip: 1 })],
    { columnOf: () => Promise.reject(new Error("database is locked")) },
  );
  await dispatchArrival("root", arrival({ cardId: "card-9" }), d);
  await dispatchArrival("root", arrival(), d);
  assertEquals(pendingCards("root", "queued-5"), ["card-1"]);
  launched.length = 0;
  await endAll();
  assertEquals(launched, []);
  assertEquals(pendingCards("root", "queued-5"), []);
});

// Closing a workspace leaves its board file behind. Firing runs into a workspace the
// user thinks is gone is the wrong surprise — the rule schedule.ts already follows.
Deno.test("a scope missing from the layout does not fire", async () => {
  const { deps: d, launched } = deps(
    [def("worker", { kanban: "In Progress" })],
    { cwd: undefined },
  );
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched, []);
});

// The two guards are check-then-act across the whole of launch(), and the real
// launchAutomaton does not register the run until the very end of a resolution that
// takes hundreds of ms. `slowly` reproduces that window; arrivals are dispatched without
// awaiting, which is how the board's handler calls them. Without the serialization in
// kanban.ts both of these tests see two runs where there should be one.
function slowly(d: DispatchDeps): DispatchDeps {
  return {
    ...d,
    launch: async (o) => {
      await new Promise((r) => setTimeout(r, 20));
      return await d.launch(o);
    },
  };
}

Deno.test("two arrivals inside one launch window still respect wip:", async () => {
  const { deps: d, launched } = deps(
    [def("queued-6", { kanban: "In Progress", wip: 1 })],
  );
  const slow = slowly(d);
  const first = dispatchArrival("root", arrival({ cardId: "card-9" }), slow);
  const second = dispatchArrival("root", arrival(), slow);
  await Promise.all([first, second]);
  assertEquals(launched.map((l) => l.card), ["card-9"]);
  assertEquals(pendingCards("root", "queued-6"), ["card-1"]);
});

Deno.test("the same card twice inside one launch window starts one run", async () => {
  const { deps: d, launched } = deps(
    [def("concurrent-1", { kanban: "In Progress" })],
  );
  const slow = slowly(d);
  const first = dispatchArrival("root", arrival(), slow);
  const second = dispatchArrival("root", arrival(), slow);
  await Promise.all([first, second]);
  assertEquals(launched.map((l) => l.card), ["card-1"]);
});

// The serialization is per automaton for this reason: a definition whose launch resolves
// slowly — a big package set, a cold runtime — must not hold up an arrival for a
// different one.
Deno.test("different automatons still dispatch concurrently", async () => {
  const { deps: d } = deps([]);
  const entered: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const blocking = (a: Automaton): DispatchDeps => ({
    ...d,
    list: () => Promise.resolve([a]),
    launch: async (o) => {
      entered.push(o.name);
      await gate;
      return "run-id";
    },
  });
  const first = dispatchArrival(
    "root",
    arrival(),
    blocking(def("busy-1", { kanban: "In Progress" })),
  );
  const second = dispatchArrival(
    "root",
    arrival(),
    blocking(def("busy-2", { kanban: "In Progress" })),
  );
  // A timer, so every microtask either dispatch could still be waiting on has run. Both
  // are now parked inside launch() with nothing released; one chain for both automatons
  // would leave the second still queued behind the first.
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(entered, ["busy-1", "busy-2"]);
  release();
  await Promise.all([first, second]);
});

// `wip:` holds card fires only. A manual or cron run occupying a slot would also never
// free it as far as the queue is concerned: only a card fire carries the onEnd that
// drains, so its end would leave cards waiting on a limit nothing is reaching.
Deno.test("a run no card started does not consume a wip: slot", async () => {
  const { deps: d, launched } = deps(
    [def("queued-7", { kanban: "In Progress", wip: 1 })],
  );
  // What the Launch button does: the same definition, in the same scope, with no card.
  await d.launch({
    scope: "root",
    name: "queued-7",
    cwd: "/proj/root",
    trigger: "manual",
  });
  await dispatchArrival("root", arrival(), d);
  assertEquals(launched.map((l) => l.card), [undefined, "card-1"]);
  assertEquals(pendingCards("root", "queued-7"), []);
});

// A refused launch leaves no run behind, so no onEnd will ever come for it. Stopping the
// drain there would leave everything behind it waiting on an end that cannot happen.
Deno.test("a launch that fails while draining does not strand the queue", async () => {
  const { deps: d, launched, endAll } = deps(
    [def("queued-8", { kanban: "In Progress", wip: 1 })],
  );
  const failing: DispatchDeps = {
    ...d,
    launch: (o) =>
      o.card === "card-1"
        ? Promise.reject(new Error("model unavailable"))
        : d.launch(o),
  };
  await dispatchArrival("root", arrival({ cardId: "card-9" }), failing);
  await dispatchArrival("root", arrival(), failing);
  await dispatchArrival("root", arrival({ cardId: "card-2" }), failing);
  assertEquals(pendingCards("root", "queued-8"), ["card-1", "card-2"]);
  launched.length = 0;
  await endAll();
  assertEquals(launched.map((l) => l.card), ["card-2"]);
  assertEquals(pendingCards("root", "queued-8"), []);
});

// `wip:` can be added to a definition while a run that started without one is still
// going. That run's end is then the only thing that can drain what queued behind it — so
// its onEnd has to have been attached even though the file had no limit at the time.
Deno.test("onEnd is attached to a run of a definition with no wip:", async () => {
  const { deps: d, launched, endAll } = deps(
    [def("queued-9", { kanban: "In Progress" })],
  );
  await dispatchArrival("root", arrival({ cardId: "card-9" }), d);
  const limited: DispatchDeps = {
    ...d,
    list: () =>
      Promise.resolve([def("queued-9", { kanban: "In Progress", wip: 1 })]),
  };
  await dispatchArrival("root", arrival(), limited);
  assertEquals(pendingCards("root", "queued-9"), ["card-1"]);
  launched.length = 0;
  await endAll();
  assertEquals(launched.map((l) => l.card), ["card-1"]);
});
