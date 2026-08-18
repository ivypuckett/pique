// The cron trigger: the clock that turns a `cron:` key into a launch. Deno-side only.
//
// It adds a CALLER, not a mechanism — every fire goes through the same
// launchAutomaton() the Launch button uses, with `trigger: "cron"` instead of
// "manual". Everything a scheduled run does about capability sets, refused launches
// and records is therefore whatever run.ts already does.
//
// Four decisions, all deliberate:
//
// 1. A schedule fires in the scope that OWNS the file, and nowhere else. Automatons
//    are inherited (root's are launchable from every workspace) but schedules are not
//    — otherwise one save in root would fire N runs a tick, one per open workspace,
//    each in a different directory. So this lists each scope's OWN definitions.
// 2. A fire while the previous run of that automaton is STILL GOING is dropped. An
//    hourly job that takes ninety minutes would otherwise stack sessions against one
//    shared model runtime until something gave. Dropped, not queued: a run that starts
//    at an unpredictable later time is not what a schedule asked for.
// 3. Nothing is caught up. A minute that passed while pique was closed — or while the
//    laptop was asleep — is simply gone, so there is no last-fired state to persist and
//    no burst of runs seconds after boot.
// 4. A dropped fire writes no run record. A record describes a run; there is no run.
//    It is logged instead, and the automaton's own error (if it has one) is already
//    visible in the module's list.
import { cronMatches, parseCron } from "./cron.ts";
import type { Automaton } from "./parse.ts";
import { isApproved } from "./approval.ts";
import { listAutomatons } from "./service.ts";
import { isAutomatonRunning, launchAutomaton } from "./run.ts";
import { scheduledTargets, type Target } from "./targets.ts";
import type { ScopeId } from "../scope/paths.ts";

// What tickOnce needs from the rest of the app. Injected so the tick's rules —
// which definitions fire, and what stops one from firing — are testable without a
// model runtime, a session or a real minute passing.
export interface TickDeps {
  targets: () => Promise<Target[]>;
  // A scope's OWN definitions, never its inherited ones. See decision 1.
  list: (scope: ScopeId) => Promise<Automaton[]>;
  // May this definition fire with no human present? A `cron:` key is a request to run
  // unattended, not permission to — see approval.ts and docs/security.md finding 1.
  approved: (scope: ScopeId, a: Automaton) => Promise<boolean>;
  running: (scope: ScopeId, name: string) => boolean;
  launch: (
    opts: { scope: ScopeId; name: string; cwd: string; trigger: string },
  ) => Promise<string>;
}

// Should this definition fire at `now`? A definition carrying an `error` never fires:
// its `cron:` may be the broken part, and a launch would be refused anyway — once a
// minute, filling runs/ with identical failures. The parse is redone here rather than
// cached because it happens once per definition per minute, and a stale cache of a
// file the user is editing is the more expensive kind of wrong.
export function isDue(a: Automaton, now: Date): boolean {
  if (!a.cron || a.error) return false;
  try {
    return cronMatches(parseCron(a.cron), now);
  } catch {
    // parse.ts already reports this as the definition's error; a schedule that cannot
    // be parsed cannot be due.
    return false;
  }
}

// One minute's worth of work. Never raises: it runs detached on a timer, so an
// escaping error would be an unhandled rejection rather than something a caller
// reports. Each scope and each launch is isolated, so one broken scope does not stop
// the rest of the minute.
export async function tickOnce(now: Date, deps: TickDeps): Promise<void> {
  let targets: Target[];
  try {
    targets = await deps.targets();
  } catch (err) {
    console.error(
      "automaton schedule: could not read the workspace layout:",
      err,
    );
    return;
  }
  for (const { scope, cwd } of targets) {
    let defs: Automaton[];
    try {
      defs = await deps.list(scope);
    } catch (err) {
      console.error(`automaton schedule: could not list ${scope}:`, err);
      continue;
    }
    for (const a of defs) {
      if (!isDue(a, now)) continue;
      // Logged every time it comes due rather than once, which is the same bargain the
      // "still running" warning below already makes: a definition nobody approved is a
      // misconfiguration to fix, and silence about a schedule that never fires is the
      // more expensive failure. The Automatons list is where it says so quietly.
      if (!await deps.approved(scope, a)) {
        console.warn(
          `automaton schedule: ${scope}/${a.name} is not approved to fire unattended; skipping`,
        );
        continue;
      }
      if (deps.running(scope, a.name)) {
        console.warn(
          `automaton schedule: ${scope}/${a.name} is still running; skipping this fire`,
        );
        continue;
      }
      try {
        await deps.launch({ scope, name: a.name, cwd, trigger: "cron" });
      } catch (err) {
        // A refused launch has already written its own `failed` record with the reason
        // (run.ts's fail()), which is the durable half. This is the log half, which for
        // a manual launch is the error thrown at whoever pressed the button.
        console.error(`automaton schedule: ${scope}/${a.name} refused:`, err);
      }
    }
  }
}

const liveDeps: TickDeps = {
  targets: scheduledTargets,
  list: listAutomatons,
  approved: isApproved,
  running: isAutomatonRunning,
  launch: launchAutomaton,
};

// How often the clock is consulted. Cron's resolution is one minute, so this only has
// to be short enough that no minute is missed — every minute is evaluated exactly once
// (see `lastMinute` below), whatever the interval.
const POLL_MS = 20_000;

// Which minute has already been evaluated, as `YYYY-MM-DDTHH:MM` in local time. Two
// polls inside the same minute must not fire a schedule twice, and a poll that lands
// late must still evaluate its own minute — comparing the minute itself does both.
// Minutes that passed with no poll at all (a suspended laptop) are not caught up, per
// decision 3.
function minuteKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${
    p(d.getHours())
  }:${p(d.getMinutes())}`;
}

// Start the clock. Called once from desktop.ts at boot, AFTER reconcileRuns — a
// `running` record left by the previous process must be repaired before this can
// consult the live map. Returns a stop function; nothing calls it today outside tests.
export function startScheduler(deps: TickDeps = liveDeps): () => void {
  let lastMinute = "";
  // A tick that outlasts the interval must not overlap the next one: launches are
  // awaited in order, and a second pass over the same minute could double-fire an
  // automaton whose first launch has not yet reached the live map.
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    const now = new Date();
    const key = minuteKey(now);
    if (key === lastMinute) return;
    lastMinute = key;
    ticking = true;
    try {
      await tickOnce(now, deps);
    } finally {
      ticking = false;
    }
  }, POLL_MS);
  // The timer must not be what keeps the process alive — the window's lifetime decides
  // that, not the scheduler's.
  Deno.unrefTimer(timer);
  return () => clearInterval(timer);
}
