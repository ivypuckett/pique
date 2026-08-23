// Frontend half of the prompts binding contract. The backend half is the prompts*
// win.bind handlers in src/desktop.ts (delegating to prompts/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { PromptInfo, PromptState } from "./service.ts";
import type { PromoteResult } from "../scope/promote.ts";
export type { PromoteResult, PromptInfo, PromptState };

// Every call names the scope it acts on: a template belongs to one scope, and saving it
// in root is what makes it invocable in every workspace. `promptsList` is a scope's own
// templates — the ones it can edit, approve or delete.
export interface PromptBindings {
  promptsList(arg: { scope: string }): Promise<PromptInfo[]>;
  promptsSave(
    arg: {
      scope: string;
      name: string;
      description: string;
      argumentHint?: string;
      body: string;
    },
  ): Promise<unknown>;
  promptsApprove(arg: { scope: string; name: string }): Promise<unknown>;
  promptsReject(arg: { scope: string; name: string }): Promise<unknown>;
  promptsDelete(
    arg: { scope: string; name: string; state: PromptState },
  ): Promise<unknown>;
  // Moves the template into root, keeping the state it was in. `{ conflict: true }` is
  // the "root already has one" answer, which the caller resolves with `overwrite`.
  promptsPromote(
    arg: {
      scope: string;
      name: string;
      state: PromptState;
      overwrite?: boolean;
    },
  ): Promise<PromoteResult>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Prompts
// section then shows a desktop-only note, same as providers/extensions.
export function promptBindings(): PromptBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as PromptBindings) : null;
}
