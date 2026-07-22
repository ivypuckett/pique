// The agent half of the shared surface: pi tools that call the same board.ts
// operations the human UI calls, tagged actor "agent". Built per chat agent, bound
// to that agent's workspace board, and passed to createAgentSession as customTools
// (see chat/agent.ts). Runs Deno-side only.
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Json } from "../settings/file.ts";
import { board } from "./service.ts";

// deno-lint-ignore no-explicit-any
function text(value: any): { content: { type: "text"; text: string }[]; details: null } {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    details: null,
  };
}

// Every tool resolves the workspace's board lazily (same cache the UI uses), so a
// board created/seeded by the UI and by the agent are one and the same file.
export function kanbanTools(
  workspaceId: string,
  readSettings: () => Promise<Json>,
): ToolDefinition[] {
  const open = async () => await board(workspaceId, await readSettings());

  return [
    defineTool({
      name: "kanban_get_board",
      label: "Get Kanban board",
      description: "Return the current board: its statuses (columns) and all cards with their " +
        "ids, titles, statuses, tags, artifacts, predecessors, successors, parent, and children.",
      parameters: Type.Object({}),
      async execute() {
        return text((await open()).getBoard());
      },
    }),

    defineTool({
      name: "kanban_set_status",
      label: "Move a Kanban card",
      description: "Move a card to a different status. A change reason is required and is " +
        "recorded in the board log.",
      parameters: Type.Object({
        card_id: Type.String(),
        status_id: Type.String(),
        reason: Type.String({ description: "Why the card is being moved." }),
      }),
      async execute(_id, p) {
        (await open()).setStatus({
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
      description: "Create a new card in the given status. Returns the new card id.",
      parameters: Type.Object({
        status_id: Type.String(),
        title: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
      }),
      async execute(_id, p) {
        const id = (await open()).createCard({
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
      description: "Update a card's title, description, and/or tags. Only provided fields change.",
      parameters: Type.Object({
        card_id: Type.String(),
        title: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        tags: Type.Optional(Type.Record(Type.String(), Type.String())),
      }),
      async execute(_id, p) {
        (await open()).setMetadata({
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
        "successors (other card ids), and parent. Only provided fields change.",
      parameters: Type.Object({
        card_id: Type.String(),
        artifacts: Type.Optional(Type.Array(Type.String())),
        predecessors: Type.Optional(Type.Array(Type.String())),
        successors: Type.Optional(Type.Array(Type.String())),
        parent_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      async execute(_id, p) {
        (await open()).setConnections({
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
