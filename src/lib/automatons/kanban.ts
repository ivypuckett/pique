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
import { normalizeColumn } from "./column.ts";
import type { Automaton } from "./parse.ts";
import { isApproved } from "./approval.ts";
import { listAutomatons } from "./service.ts";
import { launchAutomaton, liveRunsOf } from "./run.ts";
import { scopeCwd } from "./targets.ts";
import { board } from "../kanban/service.ts";
import type { CardArrival } from "../kanban/board.ts";
import type { ScopeId } from "../scope/paths.ts";

// What dispatch needs from the rest of the app. Injected so every rule above is testable
// without a board, a layout or a model runtime.
export interface DispatchDeps {
  // A scope's OWN definitions, never its inherited ones. See decision 1.
  list: (scope: ScopeId) => Promise<Automaton[]>;
  // May this definition fire with no human present? A card arriving is not a human
  // pressing Launch — an agent moves cards too (decision 5) — so this is the gate that
  // stops an agent-authored definition firing itself. See approval.ts.
  approved: (scope: ScopeId, a: Automaton) => Promise<boolean>;
  cwd: (scope: ScopeId) => Promise<string | undefined>;
  // The live CARD runs of this definition, as the cards they are working. Length is the
  // wip count, membership is the per-card guard.
  live: (scope: ScopeId, name: string) => string[];
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
  return normalizeColumn(a.kanban) === normalizeColumn(columnName);
}

// A fire waiting for a slot. The card, not the definition — the definition is re-read
// from the captured value at drain time, which is enough: a file edited while its cards
// wait is a case nobody has hit, and reading it back would need a scope walk per drain.
type Pending = { cardId: string; title: string };

// Queued fires, keyed by scope and automaton. In memory, so it dies with the app — like
// runs themselves (docs/automatons.md, "Runs do not survive quitting pique"). Bounded
// without a cap of its own: entries dedupe by card, so it cannot exceed the board.
const queues = new Map<string, Pending[]>();

// "/", because neither side can contain one: a scope id (scope/paths.ts) and a
// definition's name (automatons/paths.ts) both match /^[a-z0-9][a-z0-9-]*$/, so no pair
// of them can collide onto one queue.
const key = (scope: ScopeId, name: string) => `${scope}/${name}`;

// The cards waiting on this automaton, in arrival order — except one that startOrQueue
// put back, which goes to the end. Exported for the tests, and the only way to observe
// the queue at all.
export function pendingCards(scope: ScopeId, name: string): string[] {
  return (queues.get(key(scope, name)) ?? []).map((p) => p.cardId);
}

// In-flight guard-and-launch, one per automaton. Both guards below are check-then-act
// across the whole of deps.launch(), and launchAutomaton does not register the run until
// after it has resolved refs, imported packages and built a session — hundreds of ms in
// which deps.live() still answers as if nothing had started. Arrivals are dispatched
// fire-and-forget, so without this two of them read the same live count and both fire,
// past `wip:` and even onto the same card. Chaining each call onto the previous one for
// that automaton makes the read and the launch inseparable. (The cron trigger is safe
// from this only because tickOnce awaits its launches in order.)
//
// Per automaton and not global, so a slow launch of one definition cannot delay another's
// arrivals. An entry is dropped once its chain settles, so this holds only what is
// actually in flight.
//
// Known limit: this covers the CARD path only — the Launch button and a `cron:` call
// launchAutomaton directly. Sound today because neither carries a card and liveRunsOf
// counts only runs that do, so neither can land inside another's window and push it past
// `wip:`. Anything that ever launches WITH a card without coming through here puts both
// guards back to check-then-act, and closing that off for good needs run.ts to register a
// run before it resolves one — a larger change than a trigger should make.
const chains = new Map<string, Promise<unknown>>();

// One fire: launched, dropped with a log, or put on the queue to wait for a slot. Shared
// by the arrival path and the drain path so both apply the same two guards, and
// serialized per automaton — see `chains`.
//
// Answers whether a run of this card is now going, which is how drain() knows the pass
// consumed a slot. A REFUSED launch answers false: it creates no run, so no onEnd will
// ever come for it, and treating it as a start would strand every card behind it.
function startOrQueue(
  scope: ScopeId,
  a: Automaton,
  card: Pending,
  cwd: string,
  deps: DispatchDeps,
): Promise<boolean> {
  const k = key(scope, a.name);
  const tail = (chains.get(k) ?? Promise.resolve())
    .then(() => guarded(scope, a, card, cwd, deps))
    .catch((err) => {
      // guarded() swallows a refused launch itself, so anything arriving here is a defect
      // in the guards. Absorbed all the same: a rejected tail would reject every arrival
      // that later chains onto it, and dispatchArrival must never raise.
      console.error(`automaton kanban: ${k} could not be dispatched:`, err);
      return false;
    });
  chains.set(k, tail);
  return tail.finally(() => {
    // Only the last one out clears the entry; anything that chained on in the meantime
    // owns it now.
    if (chains.get(k) === tail) chains.delete(k);
  });
}

// The guards themselves — the stretch that must not interleave, so it is reached through
// startOrQueue and never called directly.
async function guarded(
  scope: ScopeId,
  a: Automaton,
  card: Pending,
  cwd: string,
  deps: DispatchDeps,
): Promise<boolean> {
  // Before any guard about slots: may this fire at all? Checked here rather than beside
  // `watches` because this is where the arrival path and the drain path converge, so one
  // check covers both — and an approval revoked while cards waited is honoured on drain
  // rather than only on arrival. Answers false: nothing started, so it holds no slot.
  if (!await deps.approved(scope, a)) {
    console.warn(
      `automaton kanban: ${scope}/${a.name} is not approved to fire unattended; not firing for ${card.cardId}`,
    );
    return false;
  }
  const live = deps.live(scope, a.name);
  if (live.includes(card.cardId)) {
    console.warn(
      `automaton kanban: ${scope}/${a.name} is already running ${card.cardId}; skipping`,
    );
    // A run of this card IS going — it holds the slot, and its end drains again.
    return true;
  }
  if (a.wip !== undefined && live.length >= a.wip) {
    const q = queues.get(key(scope, a.name)) ?? [];
    if (!q.some((p) => p.cardId === card.cardId)) q.push(card);
    queues.set(key(scope, a.name), q);
    return false;
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
      // Unconditional, though only a definition with a `wip:` can queue anything: the
      // limit can be edited ON while a run started without one is still going, and that
      // run ending is then the only thing that can drain what queued behind it. A drain
      // with nothing waiting costs one Map lookup.
      onEnd: () => void drain(scope, a, cwd, deps),
    });
  } catch (err) {
    // A refused launch has already written its own `failed` record with the reason
    // (run.ts's fail()), which is the durable half. This is the log half, which for a
    // manual launch is the error thrown at whoever pressed the button.
    console.error(`automaton kanban: ${scope}/${a.name} refused:`, err);
    return false;
  }
  return true;
}

// One waiting card, started. Called when a run of that automaton ends and a slot frees.
async function drain(
  scope: ScopeId,
  a: Automaton,
  cwd: string,
  deps: DispatchDeps,
): Promise<void> {
  // At most ONE card is STARTED per pass. The loop exists only to move past cards that
  // free no slot: one that has left the column, and one whose launch was refused.
  for (;;) {
    const q = queues.get(key(scope, a.name));
    if (!q || q.length === 0) return;
    // Not redundant with the identical check in startOrQueue, which happens after the
    // shift below: with no slot free, that one would push this card back on at the END of
    // the queue and it would silently lose its place in line.
    if (a.wip !== undefined && deps.live(scope, a.name).length >= a.wip) return;
    const next = q.shift()!;
    if (q.length === 0) queues.delete(key(scope, a.name));
    let column: string | undefined;
    try {
      column = await deps.columnOf(scope, next.cardId);
    } catch (err) {
      // The card is already off the queue, so this drops its fire. Deliberate: a board
      // that cannot be read will not read any better for the next card, and stopping here
      // beats hammering it. The card fires again the next time it arrives.
      console.error(
        `automaton kanban: could not re-check ${next.cardId}; dropping its queued run:`,
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
    // A started fire ends the pass: the next run to end drains again. A REFUSED one does
    // not — it leaves no run behind to drain, so stopping here would strand the rest of
    // the queue until something else happened to arrive. Bounded: each pass of this loop
    // has already shifted a card off.
    if (await startOrQueue(scope, a, next, cwd, deps)) return;
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
  let defs: Automaton[];
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
    await startOrQueue(
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
  approved: isApproved,
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
