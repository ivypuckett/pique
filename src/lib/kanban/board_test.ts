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

Deno.test("setConnections updates artifacts and parent", () => {
  const { b, status } = fresh();
  const parent = b.createCard({ statusId: status("Todo"), actor: "human" });
  const child = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setConnections({ cardId: child, parentId: parent, artifacts: ["https://x"], actor: "human" });
  assertEquals(card(b, child).parentId, parent);
  assertEquals(card(b, child).artifacts, ["https://x"]);
  assertEquals(card(b, parent).children, [child]);
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

Deno.test("setConnections rejects self-parenting", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), actor: "human" });
  assertThrows(() => b.setConnections({ cardId: a, parentId: a, actor: "human" }));
  b.close();
});

Deno.test("setConnections rejects a parent cycle", () => {
  const { b, status } = fresh();
  const a = b.createCard({ statusId: status("Todo"), actor: "human" });
  const bId = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setConnections({ cardId: bId, parentId: a, actor: "human" }); // b's parent = a
  // Making a's parent = b would form a 2-cycle (a↔b); reject it.
  assertThrows(() => b.setConnections({ cardId: a, parentId: bId, actor: "human" }));
  assertEquals(card(b, a).parentId, null); // unchanged after the rejected write
  b.close();
});

Deno.test("deleteCard nulls children's parent and prunes predecessor refs", () => {
  const { b, status } = fresh();
  const parent = b.createCard({ statusId: status("Todo"), actor: "human" });
  const child = b.createCard({ statusId: status("Todo"), actor: "human" });
  const dep = b.createCard({ statusId: status("Todo"), actor: "human" });
  b.setConnections({ cardId: child, parentId: parent, actor: "human" });
  b.setConnections({ cardId: dep, predecessors: [parent], actor: "human" });
  b.deleteCard(parent);
  assertEquals(card(b, child).parentId, null);
  assertEquals(card(b, dep).predecessors, []);
  b.close();
});
