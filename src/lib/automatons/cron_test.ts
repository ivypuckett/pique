import { assertEquals, assertThrows } from "@std/assert";
import { cronError, cronMatches, parseCron } from "./cron.ts";

// Local time throughout, because a schedule is written by a human sitting at this
// machine (see the module comment). new Date(y, m, d, h, min) is local by construction.
const at = (
  y: number,
  mon: number,
  day: number,
  hour: number,
  min: number,
): Date => new Date(y, mon - 1, day, hour, min);

function fires(expr: string, d: Date): boolean {
  return cronMatches(parseCron(expr), d);
}

Deno.test("a fully-wildcard expression fires every minute", () => {
  assertEquals(fires("* * * * *", at(2026, 8, 6, 0, 0)), true);
  assertEquals(fires("* * * * *", at(2026, 8, 6, 13, 37)), true);
});

Deno.test("a fixed time fires only on that minute of that hour", () => {
  // 2026-08-06 is a Thursday.
  assertEquals(fires("30 9 * * *", at(2026, 8, 6, 9, 30)), true);
  assertEquals(fires("30 9 * * *", at(2026, 8, 6, 9, 31)), false);
  assertEquals(fires("30 9 * * *", at(2026, 8, 6, 10, 30)), false);
});

Deno.test("lists, ranges and steps select the minutes they name", () => {
  assertEquals(fires("0,30 * * * *", at(2026, 8, 6, 4, 30)), true);
  assertEquals(fires("0,30 * * * *", at(2026, 8, 6, 4, 15)), false);
  assertEquals(fires("*/15 * * * *", at(2026, 8, 6, 4, 45)), true);
  assertEquals(fires("*/15 * * * *", at(2026, 8, 6, 4, 46)), false);
  assertEquals(fires("0 9-17 * * *", at(2026, 8, 6, 17, 0)), true);
  assertEquals(fires("0 9-17 * * *", at(2026, 8, 6, 18, 0)), false);
  assertEquals(fires("0 9-17/4 * * *", at(2026, 8, 6, 13, 0)), true);
  assertEquals(fires("0 9-17/4 * * *", at(2026, 8, 6, 12, 0)), false);
});

Deno.test("day-of-week counts Sunday as both 0 and 7", () => {
  const sunday = at(2026, 8, 9, 8, 0);
  const monday = at(2026, 8, 10, 8, 0);
  assertEquals(fires("0 8 * * 0", sunday), true);
  assertEquals(fires("0 8 * * 7", sunday), true);
  assertEquals(fires("0 8 * * 0", monday), false);
  assertEquals(fires("0 8 * * 1-5", monday), true);
  assertEquals(fires("0 8 * * 1-5", sunday), false);
});

// Vixie cron's one real oddity, kept rather than "fixed": a rule read as "the 1st and
// every Monday" would be silently narrowed to "the 1st, if it is a Monday" by an AND.
Deno.test("a restricted day-of-month and day-of-week are OR'd, not AND'd", () => {
  // 2026-08-01 is a Saturday; 2026-08-03 is a Monday.
  assertEquals(fires("0 8 1 * 1", at(2026, 8, 1, 8, 0)), true);
  assertEquals(fires("0 8 1 * 1", at(2026, 8, 3, 8, 0)), true);
  assertEquals(fires("0 8 1 * 1", at(2026, 8, 4, 8, 0)), false);
  // With only one of the two restricted there is nothing to OR, so it simply applies.
  assertEquals(fires("0 8 1 * *", at(2026, 8, 3, 8, 0)), false);
  assertEquals(fires("0 8 * * 1", at(2026, 8, 1, 8, 0)), false);
});

Deno.test("the month field selects months", () => {
  assertEquals(fires("0 8 1 8 *", at(2026, 8, 1, 8, 0)), true);
  assertEquals(fires("0 8 1 8 *", at(2026, 9, 1, 8, 0)), false);
});

Deno.test("an expression that is not five fields is rejected", () => {
  assertThrows(() => parseCron("* * * *"), Error, "5 fields");
  assertThrows(() => parseCron("* * * * * *"), Error, "5 fields");
  assertThrows(() => parseCron(""), Error, "5 fields");
});

Deno.test("out-of-range and malformed values are rejected by field", () => {
  assertThrows(() => parseCron("60 * * * *"), Error, "minute");
  assertThrows(() => parseCron("* 24 * * *"), Error, "hour");
  assertThrows(() => parseCron("* * 0 * *"), Error, "day-of-month");
  assertThrows(() => parseCron("* * * 13 *"), Error, "month");
  assertThrows(() => parseCron("* * * * 8"), Error, "day-of-week");
  assertThrows(() => parseCron("x * * * *"), Error, "minute");
  assertThrows(() => parseCron("5-1 * * * *"), Error, "minute");
  assertThrows(() => parseCron("*/0 * * * *"), Error, "minute");
  // A bare value with a step has no range to step through, so it is not accepted
  // rather than guessed at.
  assertThrows(() => parseCron("5/10 * * * *"), Error, "minute");
});

Deno.test("cronError reports what parseCron would throw, and nothing for a good one", () => {
  assertEquals(cronError("0 9 * * 1-5"), undefined);
  assertEquals(cronError("  0 9 * * *  "), undefined);
  assertEquals(typeof cronError("nope"), "string");
});
