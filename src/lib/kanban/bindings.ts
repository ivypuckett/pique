// Frontend half of the kanban binding contract. The backend half is the kanban*
// win.bind handlers in src/desktop.ts (delegating to kanban/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { Board, LogRow } from "./board.ts";
export type { Board, CardRow, LogRow, StatusRow } from "./board.ts";

// Every call is keyed by the workspace id — each workspace has its own board DB.
// Mutations from this (human) path are logged with actor "human" on the backend.
export interface KanbanBindings {
  kanbanGetBoard(arg: { workspaceId: string }): Promise<Board>;
  kanbanGetLogs(arg: { workspaceId: string; cardId?: string }): Promise<LogRow[]>;
  kanbanCreateCard(
    arg: { workspaceId: string; statusId: string; title?: string; description?: string },
  ): Promise<{ id: string }>;
  kanbanDeleteCard(arg: { workspaceId: string; cardId: string }): Promise<unknown>;
  kanbanSetStatus(
    arg: { workspaceId: string; cardId: string; statusId: string; reason: string },
  ): Promise<unknown>;
  kanbanSetMetadata(
    arg: {
      workspaceId: string;
      cardId: string;
      title?: string;
      description?: string;
      tags?: Record<string, string>;
    },
  ): Promise<unknown>;
  kanbanSetConnections(
    arg: {
      workspaceId: string;
      cardId: string;
      artifacts?: string[];
      predecessors?: string[];
      successors?: string[];
      parentId?: string | null;
    },
  ): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Kanban
// module then shows a desktop-only note, same as providers/extensions.
export function kanbanBindings(): KanbanBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as KanbanBindings) : null;
}
