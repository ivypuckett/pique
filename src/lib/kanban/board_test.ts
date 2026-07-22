import { assertEquals } from "@std/assert";
import { openBoard } from "./board.ts";

const DEFAULTS = [{ name: "Backlog" }, { name: "Todo" }, { name: "In Progress" }, { name: "Done" }];

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
