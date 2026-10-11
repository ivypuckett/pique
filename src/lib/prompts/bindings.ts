// Frontend half of the prompts binding contract. The backend half is the prompts*
// win.bind handlers in src/desktop.ts (delegating to prompts/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { PromptInfo } from "./service.ts";
export type { PromptInfo };

export interface PromptBindings {
  promptsList(): Promise<PromptInfo[]>;
  promptsSave(
    arg: {
      name: string;
      description: string;
      argumentHint?: string;
      body: string;
    },
  ): Promise<unknown>;
  promptsDelete(arg: { name: string }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Library then
// shows a desktop-only note, same as providers/extensions.
export function promptBindings(): PromptBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as PromptBindings) : null;
}
