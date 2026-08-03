import { assertEquals, assertRejects } from "@std/assert";
import { kanbanTools } from "./agent-tools.ts";
import { board, closeAllBoards } from "./service.ts";
import { ROOT, scopeBoardPath } from "../scope/paths.ts";

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

// Tool.execute has extra pi-runtime params (signal/onUpdate/ctx) unused by these
// tools; pass undefined and read the text content back out.
// deno-lint-ignore no-explicit-any
async function run(tool: any, params: unknown): Promise<unknown> {
  const res = await tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    undefined,
  );
  const text = res.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text; // plain-string acks like "ok"
  }
}
// deno-lint-ignore no-explicit-any
const byName = (tools: any[], name: string) =>
  tools.find((t) => t.name === name);

// deno-lint-ignore no-explicit-any
async function statuses(tools: any[], params: unknown = {}) {
  const state = (await run(byName(tools, "kanban_get_board"), params)) as {
    statuses: { id: string; name: string }[];
  };
  return state.statuses;
}

Deno.test("agent tools drive the real board and log actor=agent", async () => {
  await withTempHome(async () => {
    const tools = kanbanTools("ws-agent");
    const b = await board("ws-agent");

    const cols = await statuses(tools);
    const todo = cols.find((s) => s.name === "Todo")!;
    const done = cols.find((s) => s.name === "Done")!;

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

Deno.test("an agent writes and reads back a card's subtasks", async () => {
  await withTempHome(async () => {
    const tools = kanbanTools("ws-sub");
    const todo = (await statuses(tools)).find((s) => s.name === "Todo")!;
    const { id } = (await run(byName(tools, "kanban_create_card"), {
      status_id: todo.id,
      title: "Has steps",
    })) as { id: string };

    await run(byName(tools, "kanban_set_metadata"), {
      card_id: id,
      subtasks: [{ text: "write it", done: true }, {
        text: "ship it",
        done: false,
      }],
    });

    // Read it back the way an agent would — off kanban_get_board, not the board handle.
    const seen = ((await run(byName(tools, "kanban_get_board"), {})) as {
      cards: { id: string; subtasks: { text: string; done: boolean }[] }[];
    }).cards.find((c) => c.id === id)!;
    assertEquals(seen.subtasks, [
      { text: "write it", done: true },
      { text: "ship it", done: false },
    ]);

    // Ticking one means sending the whole list back, as the tool description says.
    await run(byName(tools, "kanban_set_metadata"), {
      card_id: id,
      subtasks: [{ text: "write it", done: true }, {
        text: "ship it",
        done: true,
      }],
    });
    const b = await board("ws-sub");
    assertEquals(
      b.getBoard().cards.find((c) => c.id === id)!.subtasks.every((s) =>
        s.done
      ),
      true,
    );
    assertEquals(
      b.getLogs(id).find((l) => l.action === "set_metadata")!.actor,
      "agent",
    );
  });
});

Deno.test("a malformed subtask list from an agent is refused, not stored", async () => {
  await withTempHome(async () => {
    const tools = kanbanTools("ws-bad");
    const todo = (await statuses(tools)).find((s) => s.name === "Todo")!;
    const { id } = (await run(byName(tools, "kanban_create_card"), {
      status_id: todo.id,
      title: "Has steps",
    })) as { id: string };

    // The likeliest model mistake: bare strings instead of {text, done} objects. The
    // throw reaches the agent as a tool error, so it can retry with the right shape.
    await assertRejects(() =>
      run(byName(tools, "kanban_set_metadata"), {
        card_id: id,
        subtasks: ["do the thing"],
      })
    );
    assertEquals((await board("ws-bad")).getBoard().cards[0].subtasks, []);
  });
});

Deno.test("each scope gets its own board file", async () => {
  await withTempHome(async () => {
    await board("ws-1");
    await board("ws-2");
    await board(ROOT);
    assertEquals(await exists(scopeBoardPath("ws-1")), true);
    assertEquals(await exists(scopeBoardPath("ws-2")), true);
    assertEquals(await exists(scopeBoardPath(ROOT)), true);
    assertEquals(scopeBoardPath("ws-1") === scopeBoardPath("ws-2"), false);
  });
});

Deno.test("a workspace agent writes to its own board, not root's", async () => {
  await withTempHome(async () => {
    const tools = kanbanTools("ws-1");
    const todo = (await statuses(tools)).find((s) => s.name === "Todo")!;

    await run(byName(tools, "kanban_create_card"), {
      status_id: todo.id,
      title: "Local",
    });

    assertEquals((await board("ws-1")).getBoard().cards.map((c) => c.title), [
      "Local",
    ]);
    assertEquals((await board(ROOT)).getBoard().cards, []);
  });
});

Deno.test("a workspace agent can reach root's shared board with scope=root", async () => {
  await withTempHome(async () => {
    const tools = kanbanTools("ws-1");
    const rootTodo = (await statuses(tools, { scope: "root" })).find((s) =>
      s.name === "Todo"
    )!;

    await run(byName(tools, "kanban_create_card"), {
      status_id: rootTodo.id,
      title: "Shared",
      scope: "root",
    });

    assertEquals((await board(ROOT)).getBoard().cards.map((c) => c.title), [
      "Shared",
    ]);
    assertEquals((await board("ws-1")).getBoard().cards, []);
  });
});

Deno.test("a root agent stays on root's board whatever scope it passes", async () => {
  await withTempHome(async () => {
    const tools = kanbanTools(ROOT);
    const todo = (await statuses(tools)).find((s) => s.name === "Todo")!;

    // "own" and "root" are the same board here — root has no other to address.
    await run(byName(tools, "kanban_create_card"), {
      status_id: todo.id,
      title: "A",
    });
    await run(byName(tools, "kanban_create_card"), {
      status_id: todo.id,
      title: "B",
      scope: "root",
    });

    assertEquals(
      (await board(ROOT)).getBoard().cards.map((c) => c.title).sort(),
      ["A", "B"],
    );
  });
});

Deno.test("every scope's board is seeded with the same default columns", async () => {
  await withTempHome(async () => {
    const names = ["Backlog", "Todo", "In Progress", "Done"];
    assertEquals(
      (await board(ROOT)).getBoard().statuses.map((s) => s.name),
      names,
    );
    assertEquals(
      (await board("ws-1")).getBoard().statuses.map((s) => s.name),
      names,
    );
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
