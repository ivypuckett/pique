import { assertEquals } from "@std/assert";
import type { LogRow } from "./board.ts";
import { historyEntries, type Names } from "./history.ts";

const NAMES: Names = {
  status: (id) => ({ s1: "TODO", s2: "Done" })[id] ?? "(deleted column)",
  card: (id) => ({ c9: "Ship it" })[id] ?? id,
};

function row(over: Partial<LogRow>): LogRow {
  return {
    id: "l1",
    cardId: "c1",
    ts: 1000,
    actor: "human",
    action: "set_metadata",
    from: null,
    to: null,
    reason: null,
    ...over,
  };
}

const one = (over: Partial<LogRow>) => historyEntries([row(over)], NAMES)[0];

Deno.test("a move reads as one column to the other, with its reason", () => {
  assertEquals(
    one({
      action: "set_status",
      from: JSON.stringify({ statusId: "s1" }),
      to: JSON.stringify({ statusId: "s2" }),
      reason: "tests pass",
      actor: "agent",
    }),
    {
      id: "l1",
      ts: 1000,
      actor: "agent",
      headline: "TODO → Done",
      details: ["Reason: tests pass"],
    },
  );
});

Deno.test("re-asserting the same status does not read as a move", () => {
  const e = one({
    action: "set_status",
    from: JSON.stringify({ statusId: "s2" }),
    to: JSON.stringify({ statusId: "s2" }),
    reason: "still blocked",
  });
  assertEquals(e.headline, "Kept in Done");
});

Deno.test("a column deleted since the move is named as such, not left blank", () => {
  const e = one({
    action: "set_status",
    from: JSON.stringify({ statusId: "gone" }),
    to: JSON.stringify({ statusId: "s1" }),
    reason: "reopened",
  });
  assertEquals(e.headline, "(deleted column) → TODO");
});

Deno.test("a metadata edit lists only the fields the write touched", () => {
  const e = one({
    from: JSON.stringify({ title: "Old name" }),
    to: JSON.stringify({ title: "New name" }),
  });
  assertEquals(e.headline, "Edited title");
  assertEquals(e.details, ['title: "Old name" → "New name"']);
});

Deno.test("long and multi-line values are flattened and cut", () => {
  const e = one({
    from: JSON.stringify({ description: "" }),
    to: JSON.stringify({ description: "line one\nline two " + "x".repeat(80) }),
  });
  // 18 characters of flattened prose plus 42 x's — the 60-character cut, then an ellipsis.
  assertEquals(e.details, [
    'description: empty → "line one line two ' + "x".repeat(42) + '…"',
  ]);
});

Deno.test("tags read as pairs and subtasks as a count", () => {
  const e = one({
    from: JSON.stringify({ tags: {}, subtasks: [{ text: "a", done: false }] }),
    to: JSON.stringify({
      tags: { plan: "subagents" },
      subtasks: [{ text: "a", done: true }, { text: "b", done: false }],
    }),
  });
  assertEquals(e.details, [
    "tags: none → plan: subagents",
    "subtasks: 1 item, 0 done → 2 items, 1 done",
  ]);
});

Deno.test("connection edits resolve card ids to titles", () => {
  const e = one({
    action: "set_connections",
    from: JSON.stringify({ artifacts: [], predecessors: [] }),
    to: JSON.stringify({ predecessors: ["c9"], successors: ["c9"] }),
  });
  assertEquals(e.headline, "Edited predecessors, successors");
  assertEquals(e.details, [
    "predecessors: none → Ship it",
    // No before: a successor is stored on the other card, so this row never held one.
    "successors: Ship it",
  ]);
});

Deno.test("a payload that will not parse degrades instead of throwing", () => {
  const e = one({ action: "set_status", from: "{not json", to: "{not json" });
  assertEquals(e.headline, "Kept in (deleted column)");
});

Deno.test("entries come back newest first", () => {
  const entries = historyEntries([
    row({ id: "a", ts: 1, to: JSON.stringify({ title: "first" }) }),
    row({ id: "b", ts: 2, to: JSON.stringify({ title: "second" }) }),
    row({ id: "c", ts: 3, to: JSON.stringify({ title: "third" }) }),
  ], NAMES);
  assertEquals(entries.map((e) => e.id), ["c", "b", "a"]);
});
