# Kanban-triggered Automatons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card arriving in a named kanban column launches the automaton
watching that column, with a per-card re-entrancy guard and a `wip:` cap on
concurrency.

**Architecture:** `board.ts` gains one outward callback, `onCardArrived`, fired
at the tail of `setStatus` (only when the column changed) and `createCard`.
`kanban/service.ts` — the only place a board is opened — forwards it to a
handler registered at boot by `desktop.ts`, which avoids the import cycle a
direct import would close. The handler is `automatons/kanban.ts`, the exact
sibling of `automatons/schedule.ts`: it lists the board scope's **own**
automatons, matches `kanban:` case-insensitively, applies the guards, and calls
the same `launchAutomaton()` the Launch button and the cron clock call, with
`trigger: "kanban"`.

**Tech Stack:** Deno 2.x, TypeScript, `node:sqlite`, Svelte 5 (runes),
daisyUI/Tailwind. Tests are `Deno.test` with `@std/assert`. Run everything with
`deno task test`.

**Spec:**
[docs/superpowers/specs/2026-08-06-kanban-triggered-automatons-design.md](../specs/2026-08-06-kanban-triggered-automatons-design.md)

**Read first:** `docs/automatons.md` (the `cron:` section especially — this
feature is its sibling and every decision below refers to it) and
`docs/scopes.md`.

---

### Task 0: Fix `tools:` being dropped by the save path

**This is a pre-existing bug, not part of the feature.**
`AutomatonForm.svelte:186` sends `tools`, but `AutomatonBindings.automatonsSave`
does not declare it and the `automatonsSave` handler in `desktop.ts:576-594`
does not destructure it — so saving a `tools:`-restricted automaton through the
editor silently hands the run every builtin back. Tasks 8–9 widen that same path
with two more keys, so it is fixed first rather than copied.

Skip this task if the user would rather it be handled separately; nothing later
depends on it.

**Files:**

- Modify: `src/lib/automatons/bindings.ts:15-28`
- Modify: `src/desktop.ts:571-603`
- Test: `src/lib/automatons/service_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/automatons/service_test.ts`:

```ts
// The editor sends `tools` on every save; a save path that drops it turns a deliberately
// restricted automaton back into one with every builtin. Guards the whole round trip.
Deno.test("saveAutomaton round-trips an empty tools restriction", async () => {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    await saveAutomaton("root", "restricted", {
      description: "",
      prompt: "p",
      extensions: [],
      skills: [],
      tools: [],
    });
    const [a] = await listAutomatons("root");
    assertEquals(a.tools, []);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});
```

Check the imports at the top of that file already include `listAutomatons` and
`saveAutomaton` from `./service.ts`; add whichever is missing.

- [ ] **Step 2: Run it**

```bash
deno test -A src/lib/automatons/service_test.ts
```

Expected: this test PASSES — `saveAutomaton` itself is correct, and the bug is
one layer up in the bind. It is worth having anyway as the regression floor. The
real fix is verified by reading the two files in step 3.

- [ ] **Step 3: Forward `tools` through the bind**

In `src/lib/automatons/bindings.ts`, add to the `automatonsSave` arg type,
directly above `model`:

```ts
// Which of pi's builtins the run keeps. Absent and empty are DIFFERENT — absent is
// every builtin, `[]` is none — so this is passed through rather than defaulted.
tools?: string[];
```

In `src/desktop.ts`, add `tools,` to the destructure (after
`skills: skillRefs,`), add `tools?: string[];` to the cast type, and add
`tools,` to the `saveAutomaton` call.

- [ ] **Step 4: Verify the whole suite still passes**

```bash
deno task test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/automatons/bindings.ts src/desktop.ts src/lib/automatons/service_test.ts
git commit -m "Fix tools: being dropped by the automaton save bind"
```

---

### Task 1: `kanban:` and `wip:` in the file format

Pure format work — no filesystem, no board. `parse.ts` validates `wip:` fully
and `kanban:` only as a non-empty string; whether the column exists is a UI
check (spec decision 8).

**Files:**

- Modify: `src/lib/automatons/parse.ts`
- Test: `src/lib/automatons/parse_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/automatons/parse_test.ts`:

```ts
Deno.test("kanban: names the column whose arrivals fire the automaton", () => {
  const a = parseAutomaton(
    "worker",
    `---\nprompt: work\nkanban: "In Progress"\n---\n`,
  );
  assertEquals(a.kanban, "In Progress");
  assertEquals(a.error, undefined);
});

// Absent is the default and means no card ever fires it — every automaton written
// before the key existed.
Deno.test("no kanban: key leaves the automaton button-and-cron only", () => {
  const a = parseAutomaton("worker", `---\nprompt: work\n---\n`);
  assertEquals(a.kanban, undefined);
  assertEquals(a.wip, undefined);
});

Deno.test("wip: caps concurrent runs and must be a whole number of 1 or more", () => {
  const ok = parseAutomaton(
    "worker",
    `---\nprompt: work\nkanban: "Doing"\nwip: 3\n---\n`,
  );
  assertEquals(ok.wip, 3);
  assertEquals(ok.error, undefined);

  for (const bad of ["0", "-1", "1.5", '"3"']) {
    const a = parseAutomaton(
      "worker",
      `---\nprompt: work\nkanban: "Doing"\nwip: ${bad}\n---\n`,
    );
    assertEquals(a.wip, undefined, `wip: ${bad} must not be kept`);
    assertEquals(
      a.error?.startsWith("wip:"),
      true,
      `wip: ${bad} must be an error, got ${a.error}`,
    );
  }
});

// A limit with no trigger is inert, not an error: manual and cron launches are never
// held, so there is nothing wrong with the file — just nothing for the key to do.
Deno.test("wip: without kanban: parses clean", () => {
  const a = parseAutomaton("worker", `---\nprompt: work\nwip: 2\n---\n`);
  assertEquals(a.error, undefined);
  assertEquals(a.wip, 2);
});

Deno.test("automatonFile round-trips kanban: and wip:", () => {
  const text = automatonFile({
    description: "d",
    prompt: "work",
    extensions: [],
    skills: [],
    kanban: "In Progress",
    wip: 2,
  });
  const a = parseAutomaton("worker", text);
  assertEquals(a.kanban, "In Progress");
  assertEquals(a.wip, 2);
  assertEquals(a.error, undefined);
});

// Omitted rather than written empty, so a file with no trigger looks like every
// automaton written before the keys existed.
Deno.test("automatonFile omits an absent kanban: and wip:", () => {
  const text = automatonFile({
    description: "d",
    prompt: "work",
    extensions: [],
    skills: [],
  });
  assertEquals(text.includes("kanban:"), false);
  assertEquals(text.includes("wip:"), false);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
deno test -A src/lib/automatons/parse_test.ts
```

Expected: FAIL — `kanban` and `wip` are not properties of `Automaton`, so this
fails to type-check before it runs.

- [ ] **Step 3: Add the two keys**

In `src/lib/automatons/parse.ts`, add to the `Automaton` type after
`cron?: string;`:

```ts
// The board column whose arrivals fire this automaton, matched case-insensitively
// against the board's column names (automatons/kanban.ts). Absent means no card ever
// fires it, which stays the default. Only the SHAPE is checked here — whether the
// column exists needs a board, which this module deliberately does not have, so the
// Automatons list is what flags a name no column matches.
kanban?: string;
// The most runs of this automaton that may be live in one scope at once. Absent means
// UNLIMITED: a compiled-in default would be an arbitrary number, and unlimited is what
// "a run per card" plainly means. Inert without `kanban:` — a manual or cron launch is
// never held.
wip?: number;
```

Add, next to `modelError`:

```ts
// The error message for a `wip:` value, or undefined when it is fine. The `cronError` of
// this module: a limit that is not a limit — `0`, `1.5`, `"3"` — must fail the definition
// rather than be quietly ignored, or a file that says it holds itself to three at a time
// would run unbounded.
export function wipError(value: unknown): string | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? undefined
    : `wip: expected a whole number of 1 or more, got ${JSON.stringify(value)}`;
}
```

In `parseAutomaton`, after the `const cron = ...` line:

```ts
const kanban = (str(attrs.kanban) ?? "").trim();
const wip = attrs.wip;
```

Add to the returned object, after `cron: cron || undefined,`:

```ts
// "" and absent are both "no card fires this".
kanban: kanban || undefined,
// Kept only when it is a usable limit; a bad value is reported as the definition's
// error below rather than stored as a number it is not.
wip: typeof wip === "number" && Number.isInteger(wip) && wip >= 1
  ? wip
  : undefined,
```

And extend the `error` expression:

```ts
error: prompt
  ? (model && modelError(model)) || (cron && cronError(cron)) ||
    (wip !== undefined && wipError(wip)) || undefined
  : "prompt: required",
```

- [ ] **Step 4: Teach `automatonFile` to write them**

Add `kanban?: string;` and `wip?: number;` to its parameter type, and after the
`cron` line in the emitted array:

```ts
// Same treatment as `cron:` — omitted rather than written empty, so clearing the
// form's column picker removes the trigger instead of leaving a blank one behind.
...(a.kanban?.trim() ? [`kanban: ${JSON.stringify(a.kanban.trim())}`] : []),
...(a.wip === undefined ? [] : [`wip: ${a.wip}`]),
```

- [ ] **Step 5: Run the tests**

```bash
deno test -A src/lib/automatons/parse_test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add src/lib/automatons/parse.ts src/lib/automatons/parse_test.ts
git commit -m "Add kanban: and wip: to the automaton file format"
```

---

### Task 2: One shared layout→cwd resolution

Both triggers need "where would a run in this scope work?". Cron walks every
scope each minute; the kanban dispatcher asks about one. Written once, in a
module neither trigger owns.

**Files:**

- Create: `src/lib/automatons/targets.ts`
- Modify: `src/lib/automatons/schedule.ts:28-32,106-124`
- Modify: `src/lib/automatons/schedule_test.ts:1-10,205`

- [ ] **Step 1: Create the module**

`src/lib/automatons/targets.ts`:

```ts
// Where an unattended run works, read from the saved layout. Shared by both triggers —
// the cron clock (schedule.ts) walks every target each minute, the kanban dispatcher
// (kanban.ts) asks about the one scope whose board fired — so the resolution lives in
// neither of them.
//
// The layout, not the directories under ~/.pique/scopes/: closing a workspace leaves its
// directory behind, and firing runs into a workspace the user thinks is gone is the wrong
// surprise. Deno-side only.
import { layoutScopes, readJson, resolveModuleDir } from "../settings/file.ts";
import type { ScopeId } from "../scope/paths.ts";

// A scope a trigger may fire in, and the directory its runs would work in.
export type Target = { scope: ScopeId; cwd: string };

export async function scheduledTargets(): Promise<Target[]> {
  const layout = await readJson("layout");
  return layoutScopes(layout).map((w) => ({
    scope: w.id,
    // The same resolution a module gets: the workspace's own override, else root's, else
    // $HOME. A triggered run must work where a launched one would.
    cwd: resolveModuleDir(w.cwd, layout),
  }));
}

// One scope's working directory, or undefined when the layout has no such scope — a
// closed workspace whose board file is still on disk. A trigger with no cwd does not
// fire; see schedule.ts decision 4 for why that is the same rule for both triggers.
export async function scopeCwd(scope: ScopeId): Promise<string | undefined> {
  return (await scheduledTargets()).find((t) => t.scope === scope)?.cwd;
}
```

- [ ] **Step 2: Point `schedule.ts` at it**

Delete the `Target` type declaration (`schedule.ts:31-32`) and the whole
`scheduledTargets` function (`schedule.ts:106-117`), including its comment.
Replace the `layoutScopes` import line with:

```ts
import { scheduledTargets, type Target } from "./targets.ts";
```

Re-export the type just below the imports so `TickDeps` consumers keep their
import path:

```ts
export type { Target };
```

Remove the now-unused `ScopeId` import only if nothing else in the file uses it
— `TickDeps` does, so keep it.

- [ ] **Step 3: Update the test's import**

In `src/lib/automatons/schedule_test.ts`, move `scheduledTargets` out of the
`./schedule.ts` import list into a new one:

```ts
import { scheduledTargets } from "./targets.ts";
```

- [ ] **Step 4: Run the suite**

```bash
deno task test
```

Expected: PASS, unchanged. This task is a pure move; a behaviour change here is
a mistake.

- [ ] **Step 5: Commit**

```bash
git add src/lib/automatons/targets.ts src/lib/automatons/schedule.ts src/lib/automatons/schedule_test.ts
git commit -m "Move layout cwd resolution into automatons/targets.ts"
```

---

### Task 3: `run.ts` learns about cards, WIP and run completion

Three small additions. Both guards are answered from the live Map, for the
reason `isAutomatonRunning` already states: the Map is what "still going" means.

**Files:**

- Modify: `src/lib/automatons/run.ts:49-88,230-264,420-500,557-600`
- Test: `src/lib/automatons/run_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/automatons/run_test.ts`:

```ts
// A refused launch never reaches the live Map, so this is the one place the card can be
// observed without a model runtime: it must be on the durable record, because "why did
// this run happen" is what the record exists to answer a week later.
Deno.test("a refused kanban launch records the card that fired it", async () => {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    await assertRejects(() =>
      launchAutomaton({
        scope: "root",
        name: "nope",
        cwd: home,
        trigger: "kanban",
        card: "card-1",
      })
    );
    const [record] = await listRuns("root");
    assertEquals(record.status, "failed");
    assertEquals(record.trigger, "kanban");
    assertEquals(record.card, "card-1");
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});

// Nothing is running, so this is the empty case — the guard's floor. The populated case
// needs a real session and is covered by run_integration_test.ts.
Deno.test("liveRunsOf is empty when nothing is running", () => {
  assertEquals(liveRunsOf("root", "worker"), []);
});
```

Add `assertRejects` to the `@std/assert` import and `launchAutomaton`,
`listRuns`, `liveRunsOf` to the `./run.ts` import if they are not already there.

- [ ] **Step 2: Run it to verify it fails**

```bash
deno test -A src/lib/automatons/run_test.ts
```

Expected: FAIL — `card` is not a valid option on `launchAutomaton`, and
`liveRunsOf` does not exist.

- [ ] **Step 3: Add `card` to the record and the run**

In `RunRecord`, after `args?: string;`:

```ts
// The card that fired this run, for `trigger: "kanban"`. `trigger` says what KIND of
// thing fired it; this says which one, which is what makes an old run legible after the
// board has moved on. Absent for every other trigger.
card?: string;
```

In the `Run` interface, after `automaton: string;`:

```ts
// The card this run is working, when a kanban arrival started it. Held so the
// dispatcher's two guards — one run per card, at most `wip:` at once — are answered
// from this Map rather than by reading every record off disk.
card?: string;
// Called once, after this run leaves the Map, whatever its terminal status. The kanban
// dispatcher passes one to drain its queue; nothing else does, which is why this is a
// per-launch option rather than a module-level listener registry.
onEnd?: () => void;
```

- [ ] **Step 4: Accept and record them in `launchAutomaton`**

Add to the opts type: `card?: string;` and `onEnd?: () => void;`. Add `card` to
the destructure (`const { scope, name, cwd, args, card } = opts;`). Add `card,`
to the record written in `fail()` and to the `running` record written after the
session is created.

Add `card,` and `onEnd: opts.onEnd,` to the `const run: Run = {...}` literal.

- [ ] **Step 5: Call `onEnd` on every terminal path**

Add above `launchAutomaton` (module level):

```ts
// A run's end handler, called once the run is out of the Map. Never allowed to throw: it
// belongs to a caller (the kanban dispatcher), and its failure must not become this
// module's problem when the run itself finished cleanly.
function notifyEnd(run: Run): void {
  try {
    run.onEnd?.();
  } catch (err) {
    console.error("automaton run: its end handler failed:", err);
  }
}
```

In `finish()`, as the last statement after the `session.dispose()` try/catch:
`notifyEnd(run);`

In `stopRun()`, immediately after `run.unsubscribe();`: `notifyEnd(run);` —
**before** the patch and the abort. `session.abort()` awaits `waitForIdle()`,
which a tool call that never settles never resolves; a queue that drained only
after that would stall behind a hung run.

- [ ] **Step 6: Add `liveRunsOf`**

Directly below `isAutomatonRunning`:

```ts
// The live runs of this definition in this scope, as the cards they are working
// (undefined for a run no card started). Its LENGTH is the `wip:` count and its
// MEMBERSHIP is the per-card guard — the kanban dispatcher needs both, and asking once
// keeps them consistent with each other. Same Map, and the same reasoning, as
// isAutomatonRunning above.
export function liveRunsOf(
  scope: ScopeId,
  name: string,
): (string | undefined)[] {
  const cards: (string | undefined)[] = [];
  for (const run of runs.values()) {
    if (run.scope === scope && run.automaton === name) cards.push(run.card);
  }
  return cards;
}
```

- [ ] **Step 7: Run the tests**

```bash
deno test -A src/lib/automatons/run_test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/automatons/run.ts src/lib/automatons/run_test.ts
git commit -m "Record the card on a run, and report live runs per automaton"
```

---

### Task 4: The board's card-arrival hook

`board.ts` gains one outward callback and learns nothing about automatons. It
fires where the write already committed and the row is already in hand.

**Files:**

- Modify: `src/lib/kanban/board.ts:36-52,133-151,307-354`
- Test: `src/lib/kanban/board_test.ts`

- [ ] **Step 1: Write the failing tests**

`board_test.ts` already has a `fresh()` helper returning `{ b, status }` over an
in-memory board seeded from `DEFAULTS`. Add its watching sibling next to it:

```ts
// fresh(), plus the arrivals the board announced. Same seeded columns, so `status(name)`
// works the same way.
function watched(): {
  b: BoardHandle;
  status: (name: string) => string;
  arrivals: CardArrival[];
} {
  const arrivals: CardArrival[] = [];
  const b = openBoard(":memory:", {
    defaultStatuses: DEFAULTS,
    onCardArrived: (a) => arrivals.push(a),
  });
  const byName = new Map(b.getBoard().statuses.map((s) => [s.name, s.id]));
  return { b, status: (n) => byName.get(n)!, arrivals };
}
```

Change the import on line 2 to
`import { type BoardHandle, type CardArrival, openBoard } from "./board.ts";`
and append:

```ts
Deno.test("a card entering a column announces its arrival", () => {
  const { b, status, arrivals } = watched();
  const id = b.createCard({
    statusId: status("Backlog"),
    title: "Ship it",
    actor: "human",
  });
  arrivals.length = 0;
  b.setStatus({
    cardId: id,
    statusId: status("Todo"),
    reason: "starting",
    actor: "human",
  });
  assertEquals(arrivals, [{
    cardId: id,
    title: "Ship it",
    statusId: status("Todo"),
    statusName: "Todo",
  }]);
  b.close();
});

// Nothing entered, so nothing arrived. Without this a "move" onto the column a card is
// already in would relaunch the job that is already working it.
Deno.test("a setStatus onto the card's current column announces nothing", () => {
  const { b, status, arrivals } = watched();
  const id = b.createCard({
    statusId: status("Backlog"),
    title: "Ship it",
    actor: "human",
  });
  arrivals.length = 0;
  b.setStatus({
    cardId: id,
    statusId: status("Backlog"),
    reason: "no-op",
    actor: "human",
  });
  assertEquals(arrivals, []);
  b.close();
});

// A card typed straight into a column has arrived there as surely as one dragged in.
Deno.test("a card created in a column announces its arrival", () => {
  const { b, status, arrivals } = watched();
  const id = b.createCard({
    statusId: status("Todo"),
    title: "New",
    actor: "agent",
  });
  assertEquals(arrivals, [{
    cardId: id,
    title: "New",
    statusId: status("Todo"),
    statusName: "Todo",
  }]);
  b.close();
});

// The card DID move. A consumer that throws must not make the board disagree with what
// the user just saw happen.
Deno.test("a throwing arrival handler does not fail the move", () => {
  const b = openBoard(":memory:", {
    defaultStatuses: DEFAULTS,
    onCardArrived: () => {
      throw new Error("boom");
    },
  });
  const byName = new Map(b.getBoard().statuses.map((s) => [s.name, s.id]));
  const id = b.createCard({
    statusId: byName.get("Backlog")!,
    title: "Ship it",
    actor: "human",
  });
  b.setStatus({
    cardId: id,
    statusId: byName.get("Todo")!,
    reason: "starting",
    actor: "human",
  });
  assertEquals(b.getBoard().cards[0].statusId, byName.get("Todo")!);
  b.close();
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
deno test -A src/lib/kanban/board_test.ts
```

Expected: FAIL — `CardArrival` is not exported and `onCardArrived` is not an
option.

- [ ] **Step 3: Add the type and the option**

In `src/lib/kanban/board.ts`, after the `Board` type:

```ts
// A card ARRIVING in a column: a setStatus that changed its column, or a createCard.
// The board's only outward event, and the whole of what it says — it knows nothing about
// who listens (automatons/kanban.ts, wired up in kanban/service.ts).
//
// Not fired for a reorder within a column, a metadata edit or a connection change: none
// of those is an arrival, and firing on them would relaunch a job because somebody fixed
// a typo in a title.
export type CardArrival = {
  cardId: string;
  title: string;
  statusId: string;
  statusName: string;
};
```

Widen `openBoard`'s options:

```ts
export function openBoard(
  dbPath: string,
  opts: {
    defaultStatuses: { name: string }[];
    onCardArrived?: (arrival: CardArrival) => void;
  },
): BoardHandle {
```

- [ ] **Step 4: Add the `announce` helper and its two call sites**

Alongside the other closures inside `openBoard` (next to `log`):

```ts
// Fire-and-forget: the write has already committed, and a consumer's failure must not
// fail it. An unknown statusId announces nothing rather than a column with no name.
const announce = (cardId: string, statusId: string, title: string): void => {
  if (!opts.onCardArrived) return;
  const row = db.prepare("SELECT name FROM statuses WHERE id = ?").get(
    statusId,
  ) as { name: string } | undefined;
  if (!row) return;
  try {
    opts.onCardArrived({ cardId, title, statusId, statusName: row.name });
  } catch (err) {
    console.error("kanban: a card-arrival handler failed:", err);
  }
};
```

In `createCard`, as the last statement before `return id;`:

```ts
announce(id, statusId, title);
```

In `setStatus`, as the last statement after the `log(...)` call:

```ts
// Only a change of column is an arrival. `prev` is the row as it was BEFORE the
// update, and a move leaves the title alone, so it is the right source for both.
if (prev.status_id !== statusId) announce(cardId, statusId, prev.title);
```

- [ ] **Step 5: Run the tests**

```bash
deno test -A src/lib/kanban/board_test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kanban/board.ts src/lib/kanban/board_test.ts
git commit -m "Announce card arrivals from the board"
```

---

### Task 5: Register the handler in `kanban/service.ts`

Injected, not imported. `automatons/kanban.ts` reaches `run.ts` → `resolve.ts` →
`kanban/agent-tools.ts` → `kanban/service.ts`, so a static import back the other
way would close a cycle.

**Files:**

- Modify: `src/lib/kanban/service.ts:7-13,37-49`
- Test: `src/lib/kanban/service_test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

In `src/lib/kanban/service_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { board, closeAllBoards, setCardArrivedHandler } from "./service.ts";
import type { CardArrival } from "./board.ts";

// Every board this service opens forwards its arrivals, tagged with the scope that owns
// it — which is the only thing the service adds, and the thing the dispatcher needs to
// know whose automatons to look at.
Deno.test("an arrival reaches the registered handler with its scope", async () => {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  const seen: { scope: string; arrival: CardArrival }[] = [];
  try {
    setCardArrivedHandler((scope, arrival) => seen.push({ scope, arrival }));
    const b = await board("root");
    const [backlog] = b.getBoard().statuses;
    const id = b.createCard({
      statusId: backlog.id,
      title: "Hi",
      actor: "human",
    });
    assertEquals(seen.length, 1);
    assertEquals(seen[0].scope, "root");
    assertEquals(seen[0].arrival.cardId, id);
    assertEquals(seen[0].arrival.statusName, backlog.name);
  } finally {
    setCardArrivedHandler(undefined);
    closeAllBoards();
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
deno test -A src/lib/kanban/service_test.ts
```

Expected: FAIL — `setCardArrivedHandler` is not exported.

- [ ] **Step 3: Implement it**

In `src/lib/kanban/service.ts`, change the board import to
`import { type BoardHandle, type CardArrival, openBoard } from "./board.ts";`
and add above `const handles`:

```ts
// Who hears a card arrive. Registered at boot by desktop.ts rather than imported,
// because the consumer (automatons/kanban.ts) reaches the automaton runner, which reaches
// the pique:kanban tools, which reach this module — a static import here would close that
// cycle. `undefined` is the ordinary state in a test and in web-dev: arrivals are dropped.
let handler:
  | ((scope: ScopeId, arrival: CardArrival) => void)
  | undefined;

export function setCardArrivedHandler(
  fn: ((scope: ScopeId, arrival: CardArrival) => void) | undefined,
): void {
  handler = fn;
}
```

And in `board()`:

```ts
h = openBoard(scopeBoardPath(scope), {
  defaultStatuses: DEFAULT_STATUSES,
  // Read at call time, not captured, so a board opened before the handler was
  // registered still reports its arrivals.
  onCardArrived: (arrival) => handler?.(scope, arrival),
});
```

- [ ] **Step 4: Run the test**

```bash
deno test -A src/lib/kanban/service_test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kanban/service.ts src/lib/kanban/service_test.ts
git commit -m "Forward card arrivals from the board service"
```

---

### Task 6: The dispatcher

The heart of the feature, and the exact sibling of `schedule.ts`: injected deps,
so every rule is testable with no board, no layout and no model runtime.

**Files:**

- Create: `src/lib/automatons/kanban.ts`
- Test: `src/lib/automatons/kanban_test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/automatons/kanban_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import {
  dispatchArrival,
  type DispatchDeps,
  pendingCards,
  watches,
} from "./kanban.ts";
import type { AutomatonInfo } from "./service.ts";
import type { CardArrival } from "../kanban/board.ts";

function def(name: string, extra: Partial<AutomatonInfo> = {}): AutomatonInfo {
  return {
    name,
    scope: "root",
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
  defs: AutomatonInfo[],
  opts: {
    cwd?: string | undefined;
    live?: (scope: string, name: string) => (string | undefined)[];
    columnOf?: (scope: string, cardId: string) => Promise<string | undefined>;
  } = {},
): {
  deps: DispatchDeps;
  launched: Launched[];
  running: (string | undefined)[];
  endAll: () => Promise<void>;
} {
  const launched: Launched[] = [];
  const running: (string | undefined)[] = [];
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
      cwd: () => Promise.resolve("cwd" in opts ? opts.cwd : "/proj/root"),
      live: opts.live ?? (() => running),
      columnOf: opts.columnOf ?? (() => Promise.resolve("In Progress")),
      launch: (o) => {
        const { onEnd, ...rest } = o;
        launched.push(rest);
        running.push(o.card);
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
```

Note the deliberately distinct automaton names (`queued-1`…`queued-4`): the
queue is module state keyed by scope and name, so tests that share a name would
bleed into each other.

- [ ] **Step 2: Run them to verify they fail**

```bash
deno test -A src/lib/automatons/kanban_test.ts
```

Expected: FAIL — `./kanban.ts` does not exist.

- [ ] **Step 3: Write the dispatcher**

`src/lib/automatons/kanban.ts`:

```ts
// The kanban trigger: the dispatcher that turns a card arriving in a column into a
// launch. Deno-side only, and the exact sibling of schedule.ts — it adds a CALLER, not a
// mechanism. Every fire goes through the same launchAutomaton() the Launch button uses,
// with `trigger: "kanban"`, so everything a triggered run does about capability sets,
// refused launches and records is whatever run.ts already does.
//
// Decisions, all from docs/automatons.md:
//
// 1. The board's OWNER scope decides. This lists that scope's OWN definitions, never its
//    inherited ones — cron's rule, for cron's reason: otherwise one file in root would
//    fire a run per open workspace. A workspace can address the shared root board, so a
//    card it drops into root's column fires ROOT's automaton, in root's cwd.
// 2. One run per card. A fire for a card that automaton is already running is DROPPED,
//    not queued: the card is being worked, and a second run would duplicate rather than
//    continue it. Different cards do not block each other.
// 3. `wip:` bounds that. A fire over the limit is QUEUED, not dropped — a schedule comes
//    round again, a card does not. Absent `wip:` is unlimited.
// 4. A queued fire is re-checked when it drains. A card that has since left the column,
//    or been deleted, is dropped: not waiting for it is the whole point of having waited.
// 5. Both human and agent moves fire. That is the point — a triage automaton sorting
//    cards into a column a worker automaton watches is the workflow this exists for. It
//    follows that two automatons can pass a card back and forth indefinitely, and NOTHING
//    HERE STOPS THAT: each run ends before the next begins, so no guard ever sees two at
//    once. See docs/automatons.md.
import type { Automaton } from "./parse.ts";
import { type AutomatonInfo, listAutomatons } from "./service.ts";
import { launchAutomaton, liveRunsOf } from "./run.ts";
import { scopeCwd } from "./targets.ts";
import { board } from "../kanban/service.ts";
import type { CardArrival } from "../kanban/board.ts";
import type { ScopeId } from "../scope/paths.ts";

// What dispatch needs from the rest of the app. Injected so every rule above is testable
// without a board, a layout or a model runtime.
export interface DispatchDeps {
  // A scope's OWN definitions, never its inherited ones. See decision 1.
  list: (scope: ScopeId) => Promise<AutomatonInfo[]>;
  cwd: (scope: ScopeId) => Promise<string | undefined>;
  // The live runs of this definition, as the cards they are working. Length is the wip
  // count, membership is the per-card guard.
  live: (scope: ScopeId, name: string) => (string | undefined)[];
  // Which column this card is in NOW, or undefined when it is gone. The drain re-check.
  columnOf: (scope: ScopeId, cardId: string) => Promise<string | undefined>;
  launch: (opts: {
    scope: ScopeId;
    name: string;
    cwd: string;
    args?: string;
    card?: string;
    trigger: string;
    onEnd?: () => void;
  }) => Promise<string>;
}

// Does this definition watch that column? Case- and whitespace-insensitive, because the
// name is written by hand in one place and rendered by the board in another. A definition
// carrying an `error` never fires, for the reason isDue gives in schedule.ts.
export function watches(a: Automaton, columnName: string): boolean {
  if (!a.kanban || a.error) return false;
  return a.kanban.trim().toLowerCase() === columnName.trim().toLowerCase();
}

// A fire waiting for a slot. Not the AutomatonInfo — the definition is re-read from the
// captured value at drain time, which is enough: a file edited while its cards wait is a
// case nobody has hit, and reading it back would need a scope walk per drain.
type Pending = { cardId: string; title: string };

// Queued fires, keyed by scope and automaton. In memory, so it dies with the app — like
// runs themselves (docs/automatons.md, "Runs do not survive quitting pique"). Bounded
// without a cap of its own: entries dedupe by card, so it cannot exceed the board.
const queues = new Map<string, Pending[]>();

const key = (scope: ScopeId, name: string) => `${scope} ${name}`;

// The cards waiting on this automaton, in arrival order. Exported for the tests, and the
// only way to observe the queue at all.
export function pendingCards(scope: ScopeId, name: string): string[] {
  return (queues.get(key(scope, name)) ?? []).map((p) => p.cardId);
}

// The launch itself, or the reason there wasn't one. Shared by the arrival path and the
// drain path so both apply the same two guards.
async function start(
  scope: ScopeId,
  a: Automaton,
  card: Pending,
  cwd: string,
  deps: DispatchDeps,
): Promise<void> {
  const live = deps.live(scope, a.name);
  if (live.includes(card.cardId)) {
    console.warn(
      `automaton kanban: ${scope}/${a.name} is already running ${card.cardId}; skipping`,
    );
    return;
  }
  if (a.wip !== undefined && live.length >= a.wip) {
    const q = queues.get(key(scope, a.name)) ?? [];
    if (!q.some((p) => p.cardId === card.cardId)) q.push(card);
    queues.set(key(scope, a.name), q);
    return;
  }
  try {
    await deps.launch({
      scope,
      name: a.name,
      cwd,
      // `$1` is the id the pique:kanban tools address the card by, `$2` the title for
      // prose. Quoted so a multi-word title stays ONE positional (docs/prompts.md).
      args: `${card.cardId} ${JSON.stringify(card.title)}`,
      card: card.cardId,
      trigger: "kanban",
      // Only set when there is a limit: with no `wip:` nothing ever queues, so there is
      // nothing to drain.
      onEnd: a.wip === undefined
        ? undefined
        : () => void drain(scope, a, cwd, deps),
    });
  } catch (err) {
    // A refused launch has already written its own `failed` record with the reason
    // (run.ts's fail()), which is the durable half. This is the log half, which for a
    // manual launch is the error thrown at whoever pressed the button.
    console.error(`automaton kanban: ${scope}/${a.name} refused:`, err);
  }
}

// One waiting card, started. Called when a run of that automaton ends and a slot frees.
async function drain(
  scope: ScopeId,
  a: Automaton,
  cwd: string,
  deps: DispatchDeps,
): Promise<void> {
  for (;;) {
    const q = queues.get(key(scope, a.name));
    if (!q || q.length === 0) return;
    if (a.wip !== undefined && deps.live(scope, a.name).length >= a.wip) return;
    const next = q.shift()!;
    if (q.length === 0) queues.delete(key(scope, a.name));
    let column: string | undefined;
    try {
      column = await deps.columnOf(scope, next.cardId);
    } catch (err) {
      console.error(
        `automaton kanban: could not re-check ${next.cardId}:`,
        err,
      );
      return;
    }
    if (column === undefined || !watches(a, column)) {
      console.warn(
        `automaton kanban: ${next.cardId} left ${a.kanban}; dropping its queued run`,
      );
      // Keep going: the slot this card would have taken is still free.
      continue;
    }
    // Whether that launched or hit the per-card guard, this pass is done; the next run to
    // end drains again.
    await start(scope, a, next, cwd, deps);
    return;
  }
}

// One arrival's worth of work. Never raises: it is called from a board write that has
// already committed, and an escaping error would be an unhandled rejection rather than
// something a caller reports.
export async function dispatchArrival(
  scope: ScopeId,
  arrival: CardArrival,
  deps: DispatchDeps = liveDeps,
): Promise<void> {
  let defs: AutomatonInfo[];
  try {
    defs = await deps.list(scope);
  } catch (err) {
    console.error(`automaton kanban: could not list ${scope}:`, err);
    return;
  }
  const watchers = defs.filter((a) => watches(a, arrival.statusName));
  if (watchers.length === 0) return;

  let cwd: string | undefined;
  try {
    cwd = await deps.cwd(scope);
  } catch (err) {
    console.error(
      "automaton kanban: could not read the workspace layout:",
      err,
    );
    return;
  }
  if (cwd === undefined) {
    console.warn(
      `automaton kanban: ${scope} is not in the layout; not firing for ${arrival.cardId}`,
    );
    return;
  }

  for (const a of watchers) {
    await start(
      scope,
      a,
      { cardId: arrival.cardId, title: arrival.title },
      cwd,
      deps,
    );
  }
}

const liveDeps: DispatchDeps = {
  list: listAutomatons,
  cwd: scopeCwd,
  live: liveRunsOf,
  launch: launchAutomaton,
  columnOf: async (scope, cardId) => {
    const { cards, statuses } = (await board(scope)).getBoard();
    const card = cards.find((c) => c.id === cardId);
    if (!card) return undefined;
    return statuses.find((s) => s.id === card.statusId)?.name;
  },
};
```

- [ ] **Step 4: Run the tests**

```bash
deno test -A src/lib/automatons/kanban_test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Run the whole suite**

```bash
deno task test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/automatons/kanban.ts src/lib/automatons/kanban_test.ts
git commit -m "Add the kanban arrival dispatcher"
```

---

### Task 7: Wire it up at boot

**Files:**

- Modify: `src/desktop.ts:680-690`

- [ ] **Step 1: Register the handler**

In `src/desktop.ts`, directly after the `startScheduler()` line:

```ts
// The kanban trigger. Registered rather than imported by kanban/service.ts, which cannot
// import this module graph without closing a cycle through the pique:kanban tools. After
// reconcileRuns for the same reason the scheduler is: the dispatcher's guards consult the
// live map, and a stale `running` record must be repaired first.
{
  const kanbanTrigger = await import("./lib/automatons/kanban.ts");
  kanban.setCardArrivedHandler((scope, arrival) => {
    void kanbanTrigger.dispatchArrival(scope, arrival);
  });
}
```

- [ ] **Step 2: Type-check**

```bash
deno check src/desktop.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/desktop.ts
git commit -m "Register the kanban trigger at boot"
```

---

### Task 8: Carry the two keys through the save path

**Files:**

- Modify: `src/lib/automatons/service.ts:100-119`
- Modify: `src/lib/automatons/bindings.ts:15-28`
- Modify: `src/desktop.ts:571-603`
- Test: `src/lib/automatons/service_test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/automatons/service_test.ts`:

```ts
Deno.test("saveAutomaton round-trips the kanban trigger and its wip limit", async () => {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    await saveAutomaton("root", "worker", {
      description: "",
      prompt: "work",
      extensions: [],
      skills: [],
      kanban: "In Progress",
      wip: 2,
    });
    const [a] = await listAutomatons("root");
    assertEquals(a.kanban, "In Progress");
    assertEquals(a.wip, 2);
    assertEquals(a.error, undefined);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
deno test -A src/lib/automatons/service_test.ts
```

Expected: FAIL — `kanban` and `wip` are not on `saveAutomaton`'s argument type.

- [ ] **Step 3: Widen the three layers**

In `src/lib/automatons/service.ts`, add to `saveAutomaton`'s `a` parameter type
after `cron?: string;`:

```ts
kanban?: string;
// Absent is unlimited; see parse.ts. Passed through rather than defaulted for the
// same reason `tools` is.
wip?: number;
```

In `src/lib/automatons/bindings.ts`, add to the `automatonsSave` arg type after
`cron?: string;`:

```ts
// The board column whose arrivals fire this, or "" for no card trigger.
kanban?: string;
// Max concurrent runs of this automaton in this scope; undefined is unlimited.
wip?: number;
```

In `src/desktop.ts`'s `automatonsSave` handler, add `kanban,` and `wip,` to the
destructure, `kanban?: string;` and `wip?: number;` to the cast type, and
`kanban,` and `wip,` to the `saveAutomaton` call.

- [ ] **Step 4: Run the test**

```bash
deno test -A src/lib/automatons/service_test.ts && deno check src/desktop.ts
```

Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/automatons/service.ts src/lib/automatons/bindings.ts src/desktop.ts src/lib/automatons/service_test.ts
git commit -m "Carry kanban: and wip: through the automaton save path"
```

---

### Task 9: The editor's trigger fields

**Files:**

- Modify: `src/lib/automatons/AutomatonForm.svelte`

- [ ] **Step 1: Load this scope's columns**

Add to the imports:

```ts
import { kanbanBindings, type StatusRow } from "../kanban/bindings.ts";
```

Add beside the other binding handles:

```ts
const kanban = kanbanBindings();
```

Add beside the other `$state` declarations:

```ts
// The columns of THIS scope's own board — the only board that can fire this file, since
// the trigger does not inherit (docs/automatons.md).
let columns = $state<StatusRow[]>([]);
// The column whose arrivals fire this automaton, by name. Empty is the default: no card
// ever fires it.
let kanbanColumn = $state(initial?.kanban ?? "");
// Max concurrent runs. Empty means unlimited — there is no compiled-in default.
let wip = $state(initial?.wip === undefined ? "" : String(initial.wip));
```

In the `onMount`/`loadOptions` function that already fetches templates, models,
extensions and skills, add:

```ts
if (kanban) {
  try {
    columns = (await kanban.kanbanGetBoard({ scope })).statuses;
  } catch {
    // A board that cannot be read leaves the picker with only the file's own value,
    // which is still editable. Not worth failing the whole form for.
  }
}
```

- [ ] **Step 2: Add the validation deriveds**

Beside `modelMissing` and `scheduleError`:

```ts
// The same treatment `modelMissing` gives an unavailable model: a column the board no
// longer has stays selected rather than being silently rewritten to "no trigger".
const columnMissing = $derived(
  kanbanColumn !== "" &&
    !columns.some((c) => c.name.toLowerCase() === kanbanColumn.toLowerCase()),
);

// Checked as it is typed, by the same function the backend parses with — a limit that
// is not a limit must never be written in the first place.
const wipMessage = $derived(
  wip.trim() === "" ? undefined : wipError(Number(wip)),
);
```

Add `wipError` to the `./parse.ts` import — the form currently imports
`cronError` from `./cron.ts`, so add:

```ts
import { wipError } from "./parse.ts";
```

- [ ] **Step 3: Send them on save**

In `save()`, add to the `automatonsSave` call after `cron: cron.trim(),`:

```ts
kanban: kanbanColumn,
wip: wip.trim() === "" ? undefined : Number(wip),
```

- [ ] **Step 4: Add the markup**

Directly after the Schedule field's closing `</div>`:

```svelte
  <div class="flex flex-col gap-1">
    <label class="text-xs opacity-70" for="a-kanban">Kanban column</label>
    <select
      id="a-kanban"
      class="select select-bordered select-sm"
      bind:value={kanbanColumn}
    >
      <option value="">— none —</option>
      {#if columnMissing}
        <option value={kanbanColumn}>{kanbanColumn} (no such column)</option>
      {/if}
      {#each columns as c (c.id)}
        <option value={c.name}>{c.name}</option>
      {/each}
    </select>
    <div class="text-[0.65rem] opacity-50">
      A card arriving in this column — moved in, or created there, by a human or an
      agent — launches this automaton on that card. Only this scope's own board fires
      it, and only while pique is running.
    </div>
  </div>

  {#if kanbanColumn !== ""}
    <div class="flex flex-col gap-1">
      <label class="text-xs opacity-70" for="a-wip">Concurrent runs</label>
      <input
        id="a-wip"
        class="input input-bordered input-sm"
        placeholder="leave empty for no limit"
        bind:value={wip}
      />
      {#if wipMessage}
        <div class="break-all text-[0.65rem] text-error">{wipMessage}</div>
      {:else}
        <div class="text-[0.65rem] opacity-50">
          The most runs of this automaton at once. Cards over the limit wait their turn,
          and one that has left the column by then is dropped rather than worked late.
        </div>
      {/if}
    </div>
  {/if}
```

- [ ] **Step 5: Disable Save while the limit is invalid**

Find the Save button's `disabled={...}` expression — it already includes
`scheduleError` — and add `|| wipMessage !== undefined`.

- [ ] **Step 6: Build and eyeball it**

```bash
deno task build
```

Expected: builds clean. Then run the app (`deno task dev`), open an Automatons
module, create an automaton, and confirm the column picker lists the board's
real columns and that "Concurrent runs" appears only once a column is chosen.

- [ ] **Step 7: Commit**

```bash
git add src/lib/automatons/AutomatonForm.svelte
git commit -m "Add the kanban trigger fields to the automaton editor"
```

---

### Task 10: The trigger badge in the list

**Files:**

- Modify: `src/lib/automatons/Automatons.svelte:1-5,32-40,72-83,265-280`

- [ ] **Step 1: Load the board's columns**

Add to the imports:

```ts
import { kanbanBindings, type StatusRow } from "../kanban/bindings.ts";
```

Beside `const b = automatonBindings();`:

```ts
const kb = kanbanBindings();
```

Beside the other `$state`:

```ts
// This scope's own columns, so a `kanban:` naming one that no longer exists can be
// flagged. A rename is the only way that happens, and this is the one place it shows.
let columns = $state<StatusRow[]>([]);
```

In `refresh()`, after the `automatons = await b.automatonsVisible({ scope });`
try/catch:

```ts
if (kb) {
  try {
    columns = (await kb.kanbanGetBoard({ scope })).statuses;
  } catch {
    // The badge degrades to "unknown", not to an error strip over the whole list.
    columns = [];
  }
}
```

- [ ] **Step 2: Add the lookup helper**

Beside `runsOf`:

```ts
// Does the board still have the column this automaton names? An inherited definition
// watches its OWN scope's board, which is not the one loaded here, so it is never
// flagged — the badge only claims something about a file this scope owns.
function columnMissing(a: AutomatonInfo): boolean {
  return a.scope === scope && a.kanban !== undefined &&
    !columns.some((c) => c.name.toLowerCase() === a.kanban!.toLowerCase());
}
```

- [ ] **Step 3: Add the badge**

Directly after the `{#if a.cron}` block in the list item:

```svelte
<!-- Like a schedule, a card trigger fires only in the scope that OWNS
     the file, so an inherited one is shown but does not fire here. -->
{#if a.kanban}
  <span
    class="badge badge-xs shrink-0 {columnMissing(a)
      ? 'badge-error'
      : 'badge-outline'}"
    title={columnMissing(a)
      ? `No column named ${a.kanban} on this board; nothing will fire it`
      : a.scope === scope
      ? `Runs when a card arrives in ${a.kanban}${
        a.wip ? `, ${a.wip} at a time` : ""
      }`
      : `Watches ${a.kanban} in ${a.scope}; it does not fire here`}
  >{a.kanban}</span>
{/if}
```

- [ ] **Step 4: Show the card on a run**

The same fetch already loaded the board, so keep its cards too. Add beside
`columns`:

```ts
// Only what the run detail needs: a card's title from the id on its record.
let boardCards = $state<{ id: string; title: string }[]>([]);
```

Change the `refresh()` block added in step 1 to keep both halves:

```ts
if (kb) {
  try {
    const board = await kb.kanbanGetBoard({ scope });
    columns = board.statuses;
    boardCards = board.cards;
  } catch {
    // The badge degrades to "unknown", not to an error strip over the whole list.
    columns = [];
    boardCards = [];
  }
}
```

(Replacing the version from step 1, which set `columns` only.)

Add beside `columnMissing`:

```ts
// The card a run was fired by, by title. Falls back to the id: a card deleted since is
// exactly the case where the record is the only thing that still remembers it.
function cardTitle(id: string): string {
  return boardCards.find((c) => c.id === id)?.title || id;
}
```

Find the run detail line that renders
`{selectedRun.trigger} · {ago(selectedRun.startedAt)}` and change it to:

```svelte
{selectedRun.trigger}{#if selectedRun.card}
  · {cardTitle(selectedRun.card)}{/if} · {ago(selectedRun.startedAt)}
```

- [ ] **Step 5: Build and check**

```bash
deno task build
```

Expected: builds clean. In the app, give an automaton a `kanban:` column,
confirm the badge appears; rename that column on the board, refresh the module,
and confirm the badge goes red.

- [ ] **Step 6: Commit**

```bash
git add src/lib/automatons/Automatons.svelte
git commit -m "Show an automaton's kanban trigger in the list"
```

---

### Task 11: End-to-end through a real board

Everything above is unit-tested against injected deps. This is the one test that
proves the wiring: a real `setStatus` on a real board produces a real run
record.

**Files:**

- Modify: `src/lib/automatons/run_integration_test.ts`

- [ ] **Step 1: Write the test**

Append to `src/lib/automatons/run_integration_test.ts`, following that file's
existing temp-HOME setup helper rather than writing a new one:

```ts
// The whole chain, with nothing stubbed but the model: board.setStatus → service handler
// → dispatchArrival → launchAutomaton → a record on disk. The automaton names a prompt
// template that does not exist, so the launch is REFUSED — which is the point. A refusal
// still writes its record, so this proves the wiring without needing a model runtime.
Deno.test("a card moved into the watched column fires the automaton", async () => {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    await writeJson("layout", { root: { id: "root", cwd: home } });
    await saveAutomaton("root", "worker", {
      description: "",
      prompt: "no-such-template",
      extensions: [],
      skills: [],
      kanban: "Todo",
    });
    setCardArrivedHandler((scope, arrival) => {
      void dispatchArrival(scope, arrival);
    });

    const b = await board("root");
    const statuses = b.getBoard().statuses;
    const backlog = statuses.find((s) => s.name === "Backlog")!;
    const todo = statuses.find((s) => s.name === "Todo")!;
    const cardId = b.createCard({
      statusId: backlog.id,
      title: "Fix the login bug",
      actor: "human",
    });
    b.setStatus({
      cardId,
      statusId: todo.id,
      reason: "starting",
      actor: "human",
    });

    // The handler is synchronous into an async dispatch; give it a turn to land.
    await new Promise((r) => setTimeout(r, 50));

    const [record] = await listRuns("root");
    assertEquals(record.automaton, "worker");
    assertEquals(record.trigger, "kanban");
    assertEquals(record.card, cardId);
    assertEquals(record.status, "failed");
    assertEquals(record.args, `${cardId} "Fix the login bug"`);
  } finally {
    setCardArrivedHandler(undefined);
    closeAllBoards();
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});
```

Add the imports it needs: `dispatchArrival` from `./kanban.ts`, `board`,
`closeAllBoards` and `setCardArrivedHandler` from `../kanban/service.ts`,
`saveAutomaton` from `./service.ts`, `listRuns` from `./run.ts`, `writeJson`
from `../settings/file.ts`.

- [ ] **Step 2: Run it**

```bash
deno test -A src/lib/automatons/run_integration_test.ts
```

Expected: PASS. If `record.status` is `failed` with `automaton not found` rather
than a prompt-template error, the temp HOME is not the one `saveAutomaton` wrote
into — check the `HOME` swap happens before the first import-time read.

- [ ] **Step 3: Run the whole suite**

```bash
deno task test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/automatons/run_integration_test.ts
git commit -m "Test a card move firing an automaton end to end"
```

---

### Task 12: Documentation

**Files:**

- Modify: `docs/automatons.md`

- [ ] **Step 1: Replace Deferred #1 with a real section**

Delete the "### 1. The card-move trigger" entry from the Deferred list,
renumbering the rest, and add a `### kanban: fires it when a card arrives`
section directly after the `### cron: fires it without a button` section. It
must cover, in the voice of the surrounding document:

- The key and its matching: a column **name**, case-insensitive, and why not an
  id (a UUID cannot be read to find out what a file does).
- What counts as an arrival: a move into the column, or a card created there.
  Not a reorder, not a metadata edit, not a move onto the column the card is
  already in.
- Who fires it: **both** human and agent moves, because a triage automaton
  feeding a worker automaton is the workflow this exists for.
- **The loop.** Two automatons can pass a card back and forth indefinitely; the
  per-card guard does not stop it, because each run ends before the next begins.
  Nothing bounds it but the person reading the run list.
- The two guards: same card while running is dropped; over `wip:` is queued,
  deduped by card, and re-checked when it drains so a card that left the column
  is not worked late.
- `wip:`, and that absent means unlimited.
- Scope: it does not inherit, it fires on the board of the scope that owns the
  file, and a workspace dropping a card on root's shared board fires root's
  automaton in root's cwd.
- The queue dies with the app.
- What the run receives: `/<template> <card-id> "<title>"`, and that `$1` is the
  id and `$2` the title.
- The column-rename failure, and that the Automatons list is where it surfaces.

- [ ] **Step 2: Update the surrounding claims**

- The `### Arguments` section says "which is also how a kanban card will hand
  over its title when that trigger lands" — change to the past tense and point
  at the new section.
- The `## Runs` section says `trigger` is "`kanban` once the card-move trigger
  lands" — it has landed. Note that a `kanban` record also carries the `card`.
- Deferred "#6. Concurrency" — rewrite: `wip:` now bounds one automaton's
  kanban-triggered runs; nothing bounds the total across automatons, and cron is
  still uncapped.
- Add a new Deferred entry for the durable queue: queued fires die with the app,
  and nothing says so.

- [ ] **Step 3: Check the links and the numbering**

```bash
grep -n "Deferred #" docs/*.md
```

Expected: every cross-reference still points at the entry it means. Fix any that
the renumbering broke.

- [ ] **Step 4: Commit**

```bash
git add docs/automatons.md
git commit -m "Document the kanban trigger"
```

---

## Verification

After Task 12, the whole feature:

```bash
deno task test && deno task build
```

Then in the running app: create a prompt template, create an automaton naming it
with `kanban: Todo`, drag a card into Todo, and confirm a run appears in the
list with trigger `kanban` and the card's title.
