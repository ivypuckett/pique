// Turns a card's raw log rows into lines a human reads. board.ts records every mutation
// as a row whose `from` and `to` are JSON blobs of the fields that changed — enough to
// reconstruct what happened, but nothing anyone would want to look at. This is the one
// place that knows how to say it, and it is pure so the drawer just renders the result.
import type { Actor, LogRow, Subtask } from "./board.ts";

// Ids in a log payload are resolved through these rather than by lookup here: a column
// renamed since the move should read under its current name, and only the caller holds
// the board that knows it.
export type Names = {
  status(id: string): string;
  card(id: string): string;
};

export type HistoryEntry = {
  id: string;
  ts: number;
  actor: Actor;
  // What happened, in one line.
  headline: string;
  // Supporting lines: the reason a move required, and a before → after per field.
  details: string[];
};

// Log payloads are read defensively. A row can predate any shape this file knows about —
// the table is append-only and nothing migrates it — and a history pane that throws is
// worse than one that says less than it could.
function payload(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const v = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? v as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// Long enough to recognise an edit by, short enough for a 20rem drawer. Newlines are
// flattened for the same reason: this is a one-line summary, not the field's content.
const MAX = 60;

function quote(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "";
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat === "") return "empty";
  return `"${flat.length > MAX ? flat.slice(0, MAX) + "…" : flat}"`;
}

function tags(v: unknown): string {
  if (v === null || typeof v !== "object") return "none";
  const pairs = Object.entries(v as Record<string, unknown>)
    .map(([k, val]) => `${k}: ${val}`);
  return pairs.length > 0 ? pairs.join(", ") : "none";
}

// A count rather than the list: a checklist is edited a tick at a time, and fifteen
// unchanged item texts either side of an arrow would bury the one that moved.
function subtasks(v: unknown): string {
  if (!Array.isArray(v)) return "none";
  const done = v.filter((s) => (s as Subtask)?.done).length;
  return v.length === 0
    ? "none"
    : `${v.length} item${v.length === 1 ? "" : "s"}, ${done} done`;
}

function list(v: unknown, name: (id: string) => string): string {
  if (!Array.isArray(v)) return "none";
  return v.length > 0 ? v.map((id) => name(String(id))).join(", ") : "none";
}

function describe(field: string, v: unknown, names: Names): string {
  switch (field) {
    case "tags":
      return tags(v);
    case "subtasks":
      return subtasks(v);
    case "predecessors":
    case "successors":
      return list(v, names.card);
    case "artifacts":
      return list(v, (a) => a);
    default:
      return quote(v);
  }
}

function toEntry(row: LogRow, names: Names): HistoryEntry {
  const from = payload(row.from);
  const to = payload(row.to);
  const details: string[] = [];
  let headline: string;

  if (row.action === "set_status") {
    const before = names.status(String(from.statusId ?? ""));
    const after = names.status(String(to.statusId ?? ""));
    // setStatus is logged whether or not the column actually changed — the agent tool
    // can re-assert a status — and "TODO → TODO" reads like a bug rather than a no-op.
    headline = from.statusId === to.statusId
      ? `Kept in ${after}`
      : `${before} → ${after}`;
  } else {
    // set_metadata and set_connections share this shape, and the field names carry the
    // difference: board.ts writes into `to` only the fields the call actually touched,
    // so its keys ARE the list of what changed.
    const changed = Object.keys(to);
    headline = changed.length > 0
      ? `Edited ${changed.join(", ")}`
      : "Edited nothing";
    for (const field of changed) {
      const after = describe(field, to[field], names);
      // successors has no before: it is written as an edit to the OTHER card's
      // predecessors, so this row never captured its prior value.
      details.push(
        field in from
          ? `${field}: ${describe(field, from[field], names)} → ${after}`
          : `${field}: ${after}`,
      );
    }
  }

  if (row.reason) details.push(`Reason: ${row.reason}`);
  return { id: row.id, ts: row.ts, actor: row.actor, headline, details };
}

// Newest first. board.ts returns rows oldest-first (ORDER BY ts), which is the right
// order to build a state from and the wrong one to read: the last thing that happened is
// the thing being asked about.
export function historyEntries(logs: LogRow[], names: Names): HistoryEntry[] {
  return logs.map((row) => toEntry(row, names)).reverse();
}
