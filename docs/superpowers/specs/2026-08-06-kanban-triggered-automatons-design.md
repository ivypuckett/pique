# Kanban-triggered Automatons — Design

**Date:** 2026-08-06 **Status:** Designed

## Purpose

Let a card arriving in a column launch an automaton. This is the second of the
two triggers [2026-08-04-automatons-design.md](2026-08-04-automatons-design.md)
deferred; `cron:` shipped on 2026-08-06 (7122b14), and this is the other caller
of the same `launchAutomaton()` entry point.

The shape of the feature is a job board: a human — or another agent — drops a
card into _In Progress_, and the automaton that watches that column starts work
on that card, unattended.

## Scope

**In:**

- A `kanban:` frontmatter key naming one column to watch.
- A `wip:` frontmatter key capping concurrent runs of that automaton.
- A hook on `board.ts` so every caller of the board fires the trigger by
  construction.
- A dispatcher, `automatons/kanban.ts`, that is the exact sibling of
  `schedule.ts`: a caller, not a mechanism.
- A per-card re-entrancy guard and an in-memory queue for fires over the limit.
- Column picker and WIP field in the editor; a trigger badge in the list.

**Out:** loop protection between automatons (decision 3); a queue that survives
a restart; a global concurrency ceiling; firing on card edits other than arrival
(decision 1); a `wip:` that also holds manual and cron launches.

## What already exists (verified 2026-08-06)

Each of these is what makes a decision below cheap.

| Need                     | Mechanism                                                                    | Where                        |
| ------------------------ | ---------------------------------------------------------------------------- | ---------------------------- |
| One entry point per run  | `launchAutomaton({ scope, name, cwd, args, trigger })`                       | `automatons/run.ts:230`      |
| A `trigger` on records   | `RunRecord.trigger`, already documented as taking `"kanban"`                 | `automatons/run.ts:56`       |
| One choke point per move | `setStatus` / `createCard`, called by both the human bind and the agent tool | `kanban/board.ts:307,335`    |
| One place boards open    | `board(scope)`, a per-scope cache                                            | `kanban/service.ts:41`       |
| A scope's own defs       | `listAutomatons(scope)`, as cron uses it                                     | `automatons/service.ts`      |
| Layout → cwd             | `scheduledTargets()`                                                         | `automatons/schedule.ts:109` |
| A live-run map           | `runs`, and `isAutomatonRunning(scope, name)`                                | `automatons/run.ts:89,557`   |

## Decisions

### 1. Arrival is the event: entering a column, or being created in one

A `setStatus` whose destination differs from the card's current column fires. A
`createCard` into the watched column fires — a card typed straight into _Inbox_
has arrived there as surely as one dragged in.

Nothing else does. A `setStatus` to the column the card is already in does not
(nothing entered); `moveCard` reordering within a column does not (ordering is a
view concern, which is why `board.ts` does not even log it); `setMetadata` and
`setConnections` do not, so fixing a typo in a title does not relaunch a job.

### 2. The trigger names a column by name, not by id

```yaml
kanban: "In Progress"
```

Matched case-insensitively against the board's column names, after trimming.
Column ids are stable across renames and would survive one, but they are UUIDs:
nobody hand-writes one, and a file holding one cannot be read to find out what
it does. Readability wins, consistent with every other key in the format.

The cost is that renaming a column stops the trigger. That is surfaced, not
silent — see decision 8.

### 3. Both human and agent moves fire it, and loops are possible

An automaton holding `pique:kanban` can move cards, so an automaton can fire
another automaton. That is the point: a triage automaton sorting cards into
_Ready_ so a worker automaton picks them up is the workflow this feature exists
for, and filtering to `actor: "human"` would kill it.

It follows that two automatons can hand a card back and forth indefinitely.
**The per-card guard does not prevent this** — each run finishes before the next
begins, so nothing is ever concurrent and nothing is ever dropped. A chain-depth
cap was considered and rejected as machinery for a hazard nobody has hit; the
hazard is documented instead, in `docs/automatons.md`, plainly enough that
someone building a two-automaton chain will read it first.

### 4. Same card, same automaton, already running → dropped

Not queued. The card is being worked by that automaton right now; a second run
would duplicate the work rather than continue it. This is what
`docs/automatons.md` Deferred #1 was reaching for when it said a card carries an
identity a schedule does not.

Different cards do **not** block each other. Two cards dropped into the column
together get a run each, which is the behaviour `wip:` exists to bound.

### 5. `wip:` bounds concurrency per automaton, per scope

```yaml
wip: 3
```

A positive integer: the most runs of _this_ automaton that may be live in _this_
scope at once. **Absent means unlimited.** A compiled-in default would be an
arbitrary number, which is the reason automatons have no turn cap either, and
unlimited is what "a run per card" plainly means.

A value that is not an integer ≥ 1 is an error on the whole definition,
alongside a malformed `cron:` or `model:` — a file that says it limits itself
and does not is the failure this format keeps refusing to ship.

On a definition with no `kanban:` it is inert. Manual and cron launches are
never held: `wip:` describes an arrival rate, and neither of those has one.

### 6. A fire over the limit is queued, and re-checked when it drains

FIFO per `(scope, automaton)`, deduped by card id, drained when any run of that
automaton ends — including one that failed or was stopped. Dropping instead
would mean a card silently never gets worked, which is different from a skipped
cron minute: a schedule comes round again, a card does not.

Because entries dedupe by card, the queue is bounded by the board's card count
and needs no cap of its own.

At drain time the entry is re-checked and dropped if the card no longer exists
or has since left the watched column. That is the point of having waited — a
card a human pulled back out of _In Progress_ must not be worked ten minutes
later because it was sitting in a queue.

The queue is in memory and dies with the app, like runs themselves
(`docs/automatons.md`, "Runs do not survive quitting pique"). There is no daemon
behind any of this.

### 7. The board's owner scope decides, and the trigger does not inherit

The dispatcher lists the **own** definitions of the scope whose board fired —
never its inherited ones. This is cron's rule (`schedule.ts` decision 1) for
cron's reason: otherwise one file in root would fire a run per open workspace.

A workspace can address the shared root board, so a card a workspace user drops
into root's _Review_ fires root's automaton, in root's cwd. The board's owner
decides, not who did the dragging — which is the same visibility rule
`resolveBoardScope` already implements.

cwd resolves exactly as the scheduler resolves it, from the saved layout. A
scope with no layout entry — a closed workspace whose board file is still on
disk — drops and logs, matching "it does not fire for a closed workspace". The
resolution moves out of `schedule.ts` into one shared helper rather than being
written twice.

A definition carrying an `error` never fires, as with cron.

### 8. A column that does not exist is a UI error, not a parse error

`parse.ts` is pure and has no board to consult, so it validates `kanban:` as a
non-empty string and stops there.

Whether the column exists is checked where a board is already in hand: the
Automatons list badges an automaton naming no existing column, and the editor's
field is a picker over real columns so a broken one is rarely written at all.

This is deliberately a step down from cron, where a bad expression makes the
definition unlaunchable. A cron expression is wrong when it is written; a column
name becomes wrong later, through a rename nobody connected to this file.
Refusing to launch by hand because of that would punish the wrong action.

### 9. The run receives the card id and its title

Args are `<card-id> "<title>"`, the title quoted so a multi-word one stays a
single positional (pi's argument splitting handles quotes —
[prompts.md](../../prompts.md)). The first message is therefore:

```
/work-card 9f3c… "Fix the login bug"
```

`$1` is the id the `pique:kanban` tools address the card by, `$2` is the title
for prose, `$@` is both. No new mechanism: this is the argument box the Launch
button already has, which is what
[2026-08-04-automatons-design.md](2026-08-04-automatons-design.md) predicted.

The title alone was rejected: titles are not unique and carry no way back to the
card, so a run could not reliably move or comment on the thing that triggered
it.

## Architecture

```
kanban/board.ts        setStatus / createCard  ──┐  onCardArrived(card, columnName)
kanban/service.ts      supplies the callback   ──┘  (it is the only opener, and knows the scope)
                                                │
automatons/kanban.ts   dispatch(scope, column, card)
                       ├── listAutomatons(scope)      own definitions only
                       ├── match kanban:, skip error:
                       ├── guards: per-card drop, wip queue
                       └── launchAutomaton({ ..., trigger: "kanban", card, args, onEnd })
```

### The hook lives on the board

`openBoard(path, { defaultStatuses, onCardArrived })`. `board.ts` invokes it at
the tail of `setStatus` (only when the column actually changed) and of
`createCard`, after the write.

Two alternatives were weighed. Wrapping the handle in `service.ts` leaves
`board.ts` untouched, but the wrapper has no cheap way to read the moved card's
title and would pay a whole `getBoard()` per move; the hook has the row in hand.
Notifying from the two call sites — the `kanbanSetStatus` bind and the
`kanban_set_status` tool — is least machinery and worst behaviour: a third call
site added later would silently not fire, which is the exact class of silent
underdelivery the automatons work keeps eliminating.

`board.ts` learns nothing about automatons. It calls a callback.

The dispatch is fire-and-forget: `setStatus` is synchronous and stays that way,
the dispatch is kicked off and never awaited, and a refused launch is logged
rather than thrown back. A card move must not fail because an automaton's
`prompt:` has a typo. The refusal is still durable — `launchAutomaton` writes
its own `failed` record either way.

### Changes to `run.ts`

Three, all small:

- `Run` gains `card?: string`, so both guards are answered from the live Map.
  Same posture as `isAutomatonRunning`, and for its stated reason: the Map is
  what "still going" means.
- One new export, `liveRunsOf(scope, name)`, returning the live runs' cards. Its
  length is the WIP count; its membership is the per-card guard.
- `launchAutomaton` gains an optional `card` and an optional `onEnd`, called by
  both `finish()` and `stopRun()` after eviction. That drains the queue whether
  the run finished, failed or was stopped, and avoids a global listener
  registry: only the kanban dispatcher ever passes one.

`RunRecord` gains `card?: string`. `trigger` answers what kind of thing fired
this; the card is what makes "why did _this_ run happen" answerable a week
later.

### Changes to `parse.ts`

`kanban?: string` and `wip?: number` on `Automaton`, read and written by
`automatonFile()`, both omitted when absent so a file with no trigger looks like
every automaton written before the keys existed. A `wipError()` helper alongside
`cronError()`, used by the parser and by the form's live validation.

### UI

`AutomatonForm.svelte` gets a Trigger pair beside the Schedule field: a
`<select>` over this scope's own board columns, defaulting to "— none —" and
writing the column's name; and a WIP number input, shown once a column is
chosen, blank meaning unlimited. A file naming a column the board no longer has
keeps its value in a `(no such column)` option rather than being silently
rewritten to none — the trick `modelMissing` already plays in the same form.

`Automatons.svelte` gets a second badge beside the `cron` one carrying the
column name, with the same inherited-vs-own tooltip split ("watches _In
Progress_ here" / "watches _In Progress_ in root; it does not fire here"). When
the name matches no column, that badge goes error-styled. This is the one place
a rename surfaces.

The run detail line already prints `trigger`; with a `card` on the record it
also prints that card's title when the board still has it.

## Testing

The dispatcher takes injected deps, exactly as `schedule.ts` does, so all of the
below runs with no model runtime and no board.

- **`automatons/kanban_test.ts`** — matching is case-insensitive and
  whitespace-tolerant; a definition with `error` never fires; only the scope's
  own definitions are considered; the same card while running is dropped; a
  different card is not; a fire at the WIP limit is queued; the queue dedupes by
  card; a drain re-check drops a card that left the column or was deleted; a
  scope missing from the layout drops and logs.
- **`kanban/board_test.ts`** — the hook fires on a `setStatus` that changes
  column; does not fire when the destination equals the current column; fires on
  `createCard`; a throwing callback does not fail the write.
- **`automatons/parse_test.ts`** — `kanban:` and `wip:` round-trip through
  `automatonFile`; a non-integer, zero or negative `wip:` is an error on the
  definition; `wip:` without `kanban:` parses clean and is inert.
- **`automatons/run_integration_test.ts`** — one case: a real `setStatus` on a
  real board produces a run record with `trigger: "kanban"` and the card id.

## Documentation

`docs/automatons.md` Deferred #1 becomes a `kanban:` section beside `cron:`,
covering decisions 1–9 and stating the loop hazard from decision 3 plainly.
Deferred #6 (concurrency) is rewritten now that `wip:` bounds one part of it; it
still stands for cron and for the total across automatons.

## Deferred

1. **Loop protection.** Decision 3 accepts that two automatons can pass a card
   back and forth forever. A chain-depth cap — a kanban-triggered run tagging
   the moves it makes, so a fire past depth N is dropped — is the obvious fix,
   and needs a run id threaded into `kanbanTools()`. Build it when a loop
   actually happens.
2. **A durable queue.** Queued fires die with the app. A card that was waiting
   is simply not worked, and nothing says so. Run retention
   (`docs/automatons.md` Deferred #5) is the more pressing storage problem.
3. **A global concurrency ceiling.** `wip:` is per automaton, so ten automatons
   watching ten columns can still start ten runs against one shared model
   runtime.
4. **Other board events.** Decision 1 fires on arrival only. A card whose
   subtasks all became done, or one that has sat in a column for a week, are
   both plausible triggers and neither has been asked for.
