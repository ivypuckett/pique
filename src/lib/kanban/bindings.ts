// Frontend half of the kanban binding contract. The backend half is the kanban*
// win.bind handlers in src/desktop.ts (delegating to kanban/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { Board, LogRow } from "./board.ts";
export type { Board, CardRow, LogRow, StatusRow } from "./board.ts";

// Every call is keyed by scope — each scope has its own board DB. A workspace can
// pass its own id or "root" to work the shared board it inherits; there is no way to
// name another workspace's board from here. Mutations from this (human) path are
// logged with actor "human" on the backend.
export interface KanbanBindings {
  kanbanGetBoard(arg: { scope: string }): Promise<Board>;
  kanbanGetLogs(arg: { scope: string; cardId?: string }): Promise<LogRow[]>;
  kanbanAddStatus(arg: { scope: string; name: string }): Promise<{ id: string }>;
  kanbanRenameStatus(arg: { scope: string; statusId: string; name: string }): Promise<unknown>;
  kanbanMoveStatus(arg: { scope: string; statusId: string; position: number }): Promise<unknown>;
  kanbanDeleteStatus(
    arg: { scope: string; statusId: string; withCards?: boolean },
  ): Promise<unknown>;
  kanbanCreateCard(
    arg: { scope: string; statusId: string; title?: string; description?: string },
  ): Promise<{ id: string }>;
  kanbanDeleteCard(arg: { scope: string; cardId: string }): Promise<unknown>;
  kanbanMoveCard(arg: { scope: string; cardId: string; position: number }): Promise<unknown>;
  kanbanSetStatus(
    arg: { scope: string; cardId: string; statusId: string; reason: string },
  ): Promise<unknown>;
  kanbanSetMetadata(
    arg: {
      scope: string;
      cardId: string;
      title?: string;
      description?: string;
      tags?: Record<string, string>;
    },
  ): Promise<unknown>;
  kanbanSetConnections(
    arg: {
      scope: string;
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
