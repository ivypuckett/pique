// Frontend half of the defined-tools binding contract. The backend half is the
// tools* win.bind handlers in src/desktop.ts (delegating to tools/service.ts) —
// keep arg/return shapes in sync by hand (separate module graphs).
import type { DefinedTool, ToolState } from "./service.ts";
export type { DefinedTool, ToolState };

// Every call names the scope it acts on: a tool belongs to one scope, and approving
// in root is what makes it visible to every workspace. `toolsList` is a scope's own
// tools (the ones it can approve or revoke); `toolsVisible` adds what it inherits.
export interface ToolBindings {
  toolsList(arg: { scope: string }): Promise<DefinedTool[]>;
  toolsVisible(arg: { scope: string }): Promise<DefinedTool[]>;
  toolsRead(arg: { scope: string; name: string; state: ToolState }): Promise<{ source: string }>;
  toolsApprove(arg: { scope: string; name: string }): Promise<unknown>;
  toolsReject(arg: { scope: string; name: string }): Promise<unknown>;
  toolsRevoke(arg: { scope: string; name: string }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Tools
// section then shows a desktop-only note, same as providers/extensions.
export function toolBindings(): ToolBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ToolBindings) : null;
}
