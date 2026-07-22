import { assertEquals } from "@std/assert";
import { kanbanTools } from "./agent-tools.ts";
import { board, closeAllBoards } from "./service.ts";
import { boardPath } from "./paths.ts";

// Point HOME at a throwaway dir so the service writes boards under a temp tree.
async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    closeAllBoards();
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

const SETTINGS = { kanban: { defaultStatuses: [{ name: "Todo" }, { name: "Done" }] } };
const readSettings = () => Promise.resolve(SETTINGS);

// Tool.execute has extra pi-runtime params (signal/onUpdate/ctx) unused by these
// tools; pass undefined and read the text content back out.
// deno-lint-ignore no-explicit-any
async function run(tool: any, params: unknown): Promise<unknown> {
  const res = await tool.execute("call-1", params, undefined, undefined, undefined);
  const text = res.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text; // plain-string acks like "ok"
  }
}
// deno-lint-ignore no-explicit-any
const byName = (tools: any[], name: string) => tools.find((t) => t.name === name);

Deno.test("agent tools drive the real board and log actor=agent", async () => {
  await withTempHome(async () => {
    const tools = kanbanTools("ws-agent", readSettings);
    const b = await board("ws-agent", SETTINGS);

    const boardState = (await run(byName(tools, "kanban_get_board"), {})) as {
      statuses: { id: string; name: string }[];
    };
    const todo = boardState.statuses.find((s) => s.name === "Todo")!;
    const done = boardState.statuses.find((s) => s.name === "Done")!;

    const { id } = (await run(byName(tools, "kanban_create_card"), {
      status_id: todo.id,
      title: "Agent card",
    })) as { id: string };

    await run(byName(tools, "kanban_set_status"), {
      card_id: id,
      status_id: done.id,
      reason: "agent finished it",
    });

    const card = b.getBoard().cards.find((c) => c.id === id)!;
    assertEquals(card.statusId, done.id);
    const log = b.getLogs(id).find((l) => l.action === "set_status")!;
    assertEquals(log.actor, "agent");
    assertEquals(log.reason, "agent finished it");
  });
});

Deno.test("each workspace gets its own board file", async () => {
  await withTempHome(async () => {
    await board("ws-1", SETTINGS);
    await board("ws-2", SETTINGS);
    assertEquals(await exists(boardPath("ws-1")), true);
    assertEquals(await exists(boardPath("ws-2")), true);
    assertEquals(boardPath("ws-1") === boardPath("ws-2"), false);
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
