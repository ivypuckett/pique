// The agent half of the shared surface: pi tools that call the same board.ts
// operations the human UI calls, tagged actor "agent". Built per chat agent, bound
// to that agent's scope, and passed to createAgentSession as customTools (see
// chat/agent.ts).
//
// Every tool takes an optional `scope`: "own" (default) is this workspace's board,
// "root" is the shared board it inherits. A root agent has only its own board — it
// cannot name a workspace's — so the parameter is omitted there entirely rather than
// offered and rejected. Runs Deno-side only.
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type BoardRef, board, resolveBoardScope } from "./service.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// deno-lint-ignore no-explicit-any
function text(value: any): { content: { type: "text"; text: string }[]; details: null } {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    details: null,
  };
}

// Every tool resolves its board lazily (same cache the UI uses), so a board
// created/seeded by the UI and by the agent are one and the same file.
export function kanbanTools(scope: ScopeId): ToolDefinition[] {
  const isRoot = scope === ROOT;
  const open = async (p: { scope?: string }) =>
    await board(resolveBoardScope(scope, p.scope as BoardRef | undefined));

  // Spliced into each tool's parameters. Declared unconditionally — a conditional
  // shape would widen typebox's inferred param type to a union and lose the static
  // types on `execute`. In root it is simply inert: resolveBoardScope maps root to
  // root whatever is passed, and the description says the value is ignored.
  const scopeParam = {
    scope: Type.Optional(Type.String({
      description: isRoot
        ? "Ignored: the root workspace has only its own board."
        : "Which board: 'own' (default) for this workspace's board, or 'root' for the shared board.",
    })),
  };
  const where = isRoot
    ? " Acts on the root workspace's shared board."
    : " Acts on this workspace's board by default; pass scope='root' for the shared board.";

  return [
    defineTool({
      name: "kanban_get_board",
      label: "Get Kanban board",
      description: "Return the current board: its statuses (columns) and all cards with their " +
        "ids, titles, statuses, tags, artifacts, predecessors, successors, parent, and children." +
        where,
      parameters: Type.Object({ ...scopeParam }),
      async execute(_id, p) {
        return text((await open(p)).getBoard());
      },
    }),

    defineTool({
      name: "kanban_set_status",
      label: "Move a Kanban card",
      description: "Move a card to a different status. A change reason is required and is " +
        "recorded in the board log." + where,
      parameters: Type.Object({
        card_id: Type.String(),
        status_id: Type.String(),
        reason: Type.String({ description: "Why the card is being moved." }),
        ...scopeParam,
      }),
      async execute(_id, p) {
        (await open(p)).setStatus({
          cardId: p.card_id,
          statusId: p.status_id,
          reason: p.reason,
          actor: "agent",
        });
        return text("ok");
      },
    }),

    defineTool({
      name: "kanban_create_card",
      label: "Create a Kanban card",
      description: "Create a new card in the given status. Returns the new card id." + where,
      parameters: Type.Object({
        status_id: Type.String(),
        title: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        ...scopeParam,
      }),
      async execute(_id, p) {
        const id = (await open(p)).createCard({
          statusId: p.status_id,
          title: p.title,
          description: p.description,
          actor: "agent",
        });
        return text({ id });
      },
    }),

    defineTool({
      name: "kanban_set_metadata",
      label: "Edit Kanban card metadata",
      description: "Update a card's title, description, and/or tags. Only provided fields change." +
        where,
      parameters: Type.Object({
        card_id: Type.String(),
        title: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        tags: Type.Optional(Type.Record(Type.String(), Type.String())),
        ...scopeParam,
      }),
      async execute(_id, p) {
        (await open(p)).setMetadata({
          cardId: p.card_id,
          title: p.title,
          description: p.description,
          tags: p.tags,
          actor: "agent",
        });
        return text("ok");
      },
    }),

    defineTool({
      name: "kanban_set_connections",
      label: "Edit Kanban card connections",
      description: "Update a card's connections: artifacts (external links), predecessors and " +
        "successors (other card ids), and parent. Only provided fields change." + where,
      parameters: Type.Object({
        card_id: Type.String(),
        artifacts: Type.Optional(Type.Array(Type.String())),
        predecessors: Type.Optional(Type.Array(Type.String())),
        successors: Type.Optional(Type.Array(Type.String())),
        parent_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        ...scopeParam,
      }),
      async execute(_id, p) {
        (await open(p)).setConnections({
          cardId: p.card_id,
          artifacts: p.artifacts,
          predecessors: p.predecessors,
          successors: p.successors,
          parentId: p.parent_id,
          actor: "agent",
        });
        return text("ok");
      },
    }),
  ];
}
