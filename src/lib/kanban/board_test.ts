import { assertEquals, assertThrows } from "@std/assert";
import { type BoardHandle, openBoard } from "./board.ts";

const DEFAULTS = [{ name: "Backlog" }, { name: "Todo" }, { name: "In Progress" }, { name: "Done" }];

// A seeded in-memory board plus the id of each status, for the mutation tests.
function fresh(): { b: BoardHandle; status: (name: string) => string } {
  const b = openBoard(":memory:", { defaultStatuses: DEFAULTS });
  const byName = new Map(b.getBoard().statuses.map((s) => [s.name, s.id]));
  return { b, status: (n) => byName.get(n)! };
}

function card(b: BoardHandle, id: string) {
  return b.getBoard().cards.find((c) => c.id === id)!;
}

Deno.test("openBoard creates the three tables", () => {
  const b = openBoard(":memory:", { defaultStatuses: DEFAULTS });
  const names = b.raw
    .prepare("select name from sqlite_master where type='table' order by name")
    .all()
    .map((r) => (r as { name: string }).name);
  assertEquals(names, ["cards", "logs", "statuses"]);
  b.close();
});

Deno.test("a fresh board seeds statuses from defaults, in order", () => {
  const b = openBoard(":memory:", { defaultStatuses: DEFAULTS });
  const statuses = b.getBoard().statuses;
  assertEquals(statuses.map((s) => s.name), ["Backlog", "Todo", "In Progress", "Done"]);
  assertEquals(statuses.map((s) => s.position), [0, 1, 2, 3]);
  b.close();
});

Deno.test("reopening an existing board does not re-seed", async () => {
  const path = await Deno.makeTempFile({ suffix: ".db" });
  try {
    openBoard(path, { defaultStatuses: DEFAULTS }).close();
    const b2 = openBoard(path, { defaultStatuses: DEFAULTS });
    assertEquals(b2.getBoard().statuses.length, 4);
    b2.close();
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("createCard places a card in a status and round-trips", () => {
  const { b, status } = fresh();
  const id = b.createCard({ statusId: status("Todo"), title: "Write plan", actor: "human" });
  const c = card(b, id);
  assertEquals(c.title, "Write plan");
  assertEquals(c.statusId, status("Todo"));
  b.close();
});

Deno.test("setStatus moves the card and logs from/to + reason", () => {
  const { b, status } = fresh();
  const id = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setStatus({ cardId: id, statusId: status("Done"), reason: "shipped", actor: "agent" });
  assertEquals(card(b, id).statusId, status("Done"));
  const logs = b.getLogs(id).filter((l) => l.action === "set_status");
  assertEquals(logs.length, 1);
  assertEquals(logs[0].reason, "shipped");
  assertEquals(logs[0].actor, "agent");
  assertEquals(JSON.parse(logs[0].from!).statusId, status("Todo"));
  assertEquals(JSON.parse(logs[0].to!).statusId, status("Done"));
  b.close();
});

Deno.test("setStatus throws when reason is missing or blank", () => {
  const { b, status } = fresh();
  const id = b.createCard({ statusId: status("Todo"), actor: "human" });
  assertThrows(() => b.setStatus({ cardId: id, statusId: status("Done"), reason: "", actor: "human" }));
  assertThrows(() =>
    b.setStatus({ cardId: id, statusId: status("Done"), reason: "  ", actor: "human" })
  );
  b.close();
});

Deno.test("setMetadata patches only provided fields and logs the diff", () => {
  const { b, status } = fresh();
  const id = b.createCard({ statusId: status("Todo"), title: "orig", description: "d", actor: "human" });
  b.setMetadata({ cardId: id, title: "renamed", tags: { size: "L" }, actor: "human" });
  const c = card(b, id);
  assertEquals(c.title, "renamed");
  assertEquals(c.description, "d"); // untouched
  assertEquals(c.tags, { size: "L" });
  const log = b.getLogs(id).find((l) => l.action === "set_metadata")!;
  assertEquals(JSON.parse(log.from!).title, "orig");
  assertEquals(JSON.parse(log.to!).title, "renamed");
  b.close();
});

Deno.test("setConnections with successors writes the inverse predecessor edge", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), actor: "human" });
  const bId = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setConnections({ cardId: a, successors: [bId], actor: "human" });
  assertEquals(card(b, bId).predecessors, [a]);
  assertEquals(card(b, a).successors, [bId]);
  b.close();
});

Deno.test("setConnections updates artifacts", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setConnections({ cardId: a, artifacts: ["https://x"], actor: "human" });
  assertEquals(card(b, a).artifacts, ["https://x"]);
  b.close();
});

Deno.test("a card's subtasks default to empty and round-trip through setMetadata", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), actor: "human" });
  assertEquals(card(b, a).subtasks, []);
  b.setMetadata({
    cardId: a,
    subtasks: [{ text: "write it", done: true }, { text: "ship it", done: false }],
    actor: "human",
  });
  assertEquals(card(b, a).subtasks, [
    { text: "write it", done: true },
    { text: "ship it", done: false },
  ]);
  b.close();
});

// Nothing validates a pi tool's arguments before they reach the board, so these are the
// shapes a model can actually hand it.
Deno.test("setMetadata defaults a subtask's missing done to false", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setMetadata({ cardId: a, subtasks: [{ text: "no flag" } as never], actor: "human" });
  assertEquals(card(b, a).subtasks, [{ text: "no flag", done: false }]);
  b.close();
});

Deno.test("setMetadata rejects malformed subtasks without half-applying the edit", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), title: "before", actor: "human" });
  for (const bad of [["a plain string"], [{ done: true }], [{ text: "  " }], "nope"]) {
    assertThrows(() =>
      b.setMetadata({ cardId: a, title: "after", subtasks: bad as never, actor: "human" })
    );
  }
  // The title in the same call was refused along with the subtasks.
  assertEquals(card(b, a).title, "before");
  assertEquals(card(b, a).subtasks, []);
  b.close();
});

Deno.test("setMetadata replaces the whole subtask list and leaves other fields alone", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), title: "t", actor: "human" });
  b.setMetadata({ cardId: a, subtasks: [{ text: "one", done: false }], actor: "human" });
  b.setMetadata({ cardId: a, subtasks: [{ text: "two", done: true }], actor: "human" });
  assertEquals(card(b, a).subtasks, [{ text: "two", done: true }]);
  assertEquals(card(b, a).title, "t");
  b.close();
});

Deno.test("addStatus appends a column at the end and returns its id", () => {
  const { b } = fresh();
  const id = b.addStatus({ name: "Blocked" });
  const statuses = b.getBoard().statuses;
  assertEquals(statuses.map((s) => s.name), ["Backlog", "Todo", "In Progress", "Done", "Blocked"]);
  assertEquals(statuses.map((s) => s.position), [0, 1, 2, 3, 4]);
  assertEquals(statuses.at(-1)!.id, id);
  b.close();
});

Deno.test("addStatus rejects a blank name", () => {
  const { b } = fresh();
  assertThrows(() => b.addStatus({ name: "   " }), Error, "column name cannot be empty");
  b.close();
});

Deno.test("renameStatus changes the name and keeps the id, so cards stay put", () => {
  const { b, status } = fresh();
  const todo = status("Todo");
  const cardId = b.createCard({ statusId: todo, title: "x", actor: "human" });
  b.renameStatus({ statusId: todo, name: "Next" });
  assertEquals(b.getBoard().statuses.map((s) => s.name), [
    "Backlog",
    "Next",
    "In Progress",
    "Done",
  ]);
  assertEquals(card(b, cardId).statusId, todo);
  b.close();
});

Deno.test("renameStatus rejects a blank name", () => {
  const { b, status } = fresh();
  assertThrows(
    () => b.renameStatus({ statusId: status("Todo"), name: "" }),
    Error,
    "column name cannot be empty",
  );
  b.close();
});

Deno.test("moveStatus splices a column to an absolute index and renumbers", () => {
  const { b, status } = fresh();
  b.moveStatus({ statusId: status("Done"), position: 0 });
  assertEquals(b.getBoard().statuses.map((s) => s.name), [
    "Done",
    "Backlog",
    "Todo",
    "In Progress",
  ]);
  assertEquals(b.getBoard().statuses.map((s) => s.position), [0, 1, 2, 3]);
  b.close();
});

Deno.test("moveStatus clamps an out-of-range position instead of throwing", () => {
  const { b, status } = fresh();
  b.moveStatus({ statusId: status("Backlog"), position: 99 });
  assertEquals(b.getBoard().statuses.map((s) => s.name), [
    "Todo",
    "In Progress",
    "Done",
    "Backlog",
  ]);
  b.moveStatus({ statusId: status("Backlog"), position: -5 });
  assertEquals(b.getBoard().statuses.map((s) => s.name), [
    "Backlog",
    "Todo",
    "In Progress",
    "Done",
  ]);
  b.close();
});

Deno.test("deleteStatus removes an empty column and renumbers the rest", () => {
  const { b, status } = fresh();
  b.deleteStatus({ statusId: status("In Progress") });
  const statuses = b.getBoard().statuses;
  assertEquals(statuses.map((s) => s.name), ["Backlog", "Todo", "Done"]);
  assertEquals(statuses.map((s) => s.position), [0, 1, 2]);
  b.close();
});

Deno.test("deleteStatus refuses a column that still has cards", () => {
  const { b, status } = fresh();
  b.createCard({ statusId: status("Todo"), title: "x", actor: "human" });
  b.createCard({ statusId: status("Todo"), title: "y", actor: "human" });
  assertThrows(
    () => b.deleteStatus({ statusId: status("Todo") }),
    Error,
    "cannot delete a column that still has cards (2 remaining)",
  );
  assertEquals(b.getBoard().statuses.length, 4);
  b.close();
});

Deno.test("deleteStatus with withCards deletes the column's cards and prunes their edges", () => {
  const { b, status } = fresh();
  const doomed = b.createCard({ statusId: status("Todo"), title: "x", actor: "human" });
  const after = b.createCard({ statusId: status("Done"), title: "after", actor: "human" });
  b.setConnections({ cardId: after, predecessors: [doomed], actor: "human" });

  b.deleteStatus({ statusId: status("Todo"), withCards: true });

  const statuses = b.getBoard().statuses;
  assertEquals(statuses.map((s) => s.name), ["Backlog", "In Progress", "Done"]);
  assertEquals(statuses.map((s) => s.position), [0, 1, 2]);
  assertEquals(b.getBoard().cards.map((c) => c.id).includes(doomed), false);
  assertEquals(card(b, after).predecessors, []);
  b.close();
});

Deno.test("deleteStatus with withCards still refuses the last remaining column", () => {
  const b = openBoard(":memory:", { defaultStatuses: [{ name: "Only" }] });
  const only = b.getBoard().statuses[0].id;
  b.createCard({ statusId: only, title: "x", actor: "human" });
  assertThrows(
    () => b.deleteStatus({ statusId: only, withCards: true }),
    Error,
    "a board needs at least one column",
  );
  assertEquals(b.getBoard().cards.length, 1);
  b.close();
});

Deno.test("deleteStatus refuses the last remaining column", () => {
  const b = openBoard(":memory:", { defaultStatuses: [{ name: "Only" }] });
  const only = b.getBoard().statuses[0].id;
  assertThrows(
    () => b.deleteStatus({ statusId: only }),
    Error,
    "a board needs at least one column",
  );
  b.close();
});

// Titles of one column's cards, in board order.
function column(b: BoardHandle, statusId: string): string[] {
  return b.getBoard().cards
    .filter((c) => c.statusId === statusId)
    .sort((x, y) => x.position - y.position)
    .map((c) => c.title);
}

Deno.test("moveCard splices a card to an absolute index within its column", () => {
  const { b, status } = fresh();
  for (const title of ["a", "b", "c"]) {
    b.createCard({ statusId: status("Todo"), title, actor: "human" });
  }
  const c = b.getBoard().cards.find((x) => x.title === "c")!.id;
  b.moveCard({ cardId: c, position: 0 });
  assertEquals(column(b, status("Todo")), ["c", "a", "b"]);
  assertEquals(b.getBoard().cards.map((x) => x.position).sort(), [0, 1, 2]);
  b.close();
});

Deno.test("moveCard clamps an out-of-range position and leaves other columns alone", () => {
  const { b, status } = fresh();
  for (const title of ["a", "b"]) {
    b.createCard({ statusId: status("Todo"), title, actor: "human" });
  }
  b.createCard({ statusId: status("Done"), title: "z", actor: "human" });
  const a = b.getBoard().cards.find((x) => x.title === "a")!.id;
  b.moveCard({ cardId: a, position: 99 });
  assertEquals(column(b, status("Todo")), ["b", "a"]);
  b.moveCard({ cardId: a, position: -5 });
  assertEquals(column(b, status("Todo")), ["a", "b"]);
  assertEquals(column(b, status("Done")), ["z"]);
  b.close();
});

Deno.test("deleteCard prunes predecessor refs to it", () => {
  const { b, status } = fresh();
  const gone = b.createCard({ statusId: status("Todo"), actor: "human" });
  const dep = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setConnections({ cardId: dep, predecessors: [gone], actor: "human" });
  b.deleteCard(gone);
  assertEquals(card(b, dep).predecessors, []);
  b.close();
});
