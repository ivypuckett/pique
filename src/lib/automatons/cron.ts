// The `cron:` expression format, and nothing else. Pure — no filesystem, no clock of
// its own — so a schedule is testable without waiting for one. Shaped on parse.ts,
// which does the same job for the rest of the file.
//
// Five fields, the classic ones: minute hour day-of-month month day-of-week. Each is
// `*`, a number, a range, a comma-separated list of those, or any of them with a
// `/step`. Deliberately NOT supported: names (`mon`, `jan`), `@daily` and friends,
// seconds, `L`/`W`/`#`. Every one of those is a second syntax to explain in the form's
// hint, and none has come up.
//
// Times are LOCAL. A schedule is written by a human sitting at this machine, who means
// their own 9am; pique has no notion of a timezone to interpret it in otherwise. The
// cost is that a DST jump can skip or repeat a fire, which for a desktop job runner is
// the lesser surprise.
export type CronSpec = {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  // Whether the day fields were narrowed at all, which is what decides how the two
  // combine — see cronMatches.
  domRestricted: boolean;
  dowRestricted: boolean;
};

type Field = { name: string; min: number; max: number };

const FIELDS: Field[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 7 is accepted for Sunday and folded to 0 below, as every cron does.
  { name: "day-of-week", min: 0, max: 7 },
];

// One field into the set of values it selects. Raises with the field's name in the
// message, because "60 is out of range" without it says nothing about which half of
// `0 60 * * *` is wrong.
function parseField(field: Field, text: string): Set<number> {
  const out = new Set<number>();
  const bad = (): never => {
    throw new Error(`cron: invalid ${field.name} ${JSON.stringify(text)}`);
  };
  for (const part of text.split(",")) {
    const [spec, stepText, ...rest] = part.split("/");
    if (rest.length) bad();
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText)) bad();
      step = Number(stepText);
      if (step < 1) bad();
    }
    let lo: number;
    let hi: number;
    if (spec === "*") {
      lo = field.min;
      hi = field.max;
    } else if (/^\d+-\d+$/.test(spec)) {
      [lo, hi] = spec.split("-").map(Number);
    } else if (/^\d+$/.test(spec)) {
      // A step needs a range to walk. `5/10` is likelier a typo than a request for
      // "5, 15, 25…", and guessing which would put minutes on the calendar nobody wrote.
      if (stepText !== undefined) bad();
      lo = hi = Number(spec);
    } else {
      return bad();
    }
    if (lo > hi || lo < field.min || hi > field.max) bad();
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

// Parse, or raise. The thrown message is what parse.ts surfaces as the definition's
// `error`, so it names the field and quotes what was written.
export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/).filter((p) => p !== "");
  if (parts.length !== 5) {
    throw new Error(
      `cron: expected 5 fields "minute hour day-of-month month day-of-week", got ${
        JSON.stringify(expr)
      }`,
    );
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) =>
    parseField(FIELDS[i], p)
  );
  // 7 and 0 are the same day, and a spec holding both would otherwise make `dow.size`
  // meaningless.
  if (dow.delete(7)) dow.add(0);
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

// The error message for an expression, or undefined when it is fine. The `modelError`
// of this module: parse.ts wants a message, not a throw.
export function cronError(expr: string): string | undefined {
  try {
    parseCron(expr);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// Does this spec name the minute `d` falls in? Sub-minute components are ignored: the
// scheduler evaluates each minute once (schedule.ts), so this answers per minute.
export function cronMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.minute.has(d.getMinutes())) return false;
  if (!spec.hour.has(d.getHours())) return false;
  if (!spec.month.has(d.getMonth() + 1)) return false;
  const dom = spec.dom.has(d.getDate());
  const dow = spec.dow.has(d.getDay());
  // Vixie cron's rule: when BOTH day fields are restricted they are OR'd, so
  // `0 8 1 * 1` reads "the 1st, and every Monday". With one of them `*` there is
  // nothing to OR — the wildcard matches everything, so a plain AND is already right.
  return spec.domRestricted && spec.dowRestricted ? dom || dow : dom && dow;
}
