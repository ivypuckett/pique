// Frontend half of the defined-tools binding contract. The backend half is the
// tools* win.bind handlers in src/desktop.ts (delegating to tools/service.ts) —
// keep arg/return shapes in sync by hand (separate module graphs).
import type { DefinedTool, ToolState } from "./service.ts";
export type { DefinedTool, ToolState };

// Not keyed by a chat id: defined tools are a global, per-install set under
// ~/.pique/agent, like extensions and providers.
export interface ToolBindings {
  toolsList(): Promise<DefinedTool[]>;
  toolsRead(arg: { name: string; state: ToolState }): Promise<{ source: string }>;
  toolsApprove(arg: { name: string }): Promise<unknown>;
  toolsReject(arg: { name: string }): Promise<unknown>;
  toolsRevoke(arg: { name: string }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Tools
// section then shows a desktop-only note, same as providers/extensions.
export function toolBindings(): ToolBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ToolBindings) : null;
}
