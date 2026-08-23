// Frontend half of the system-prompt-files binding contract. The backend half is the
// systemPrompts* win.bind handlers in src/desktop.ts (delegating to scope/prompt.ts) —
// keep arg/return shapes in sync by hand (separate module graphs).
//
// Type-only import: scope/prompt.ts is Deno-side, and erasing the import is what keeps
// it out of the webview bundle. Same arrangement as agents/bindings.ts over parse.ts.
import type { PromptFileInfo, PromptFileKind } from "./prompt.ts";
export type { PromptFileInfo, PromptFileKind };

// Unlike every other Library kind these are SINGLETONS: one SYSTEM.md and one
// APPEND_SYSTEM.md per scope, addressed by kind rather than by name. There is nothing
// to create and nothing to name — `systemPromptsSave` writes whichever of the two you
// point it at, and saving an empty body deletes the file (scope/prompt.ts says why).
//
// No approve/reject pair, for the reason agents/bindings.ts gives: these are written by
// the human half only. No agent tool reaches them, so there is no quarantine.
export interface SystemPromptBindings {
  // Both of the scope's OWN files, present or not — always two entries. What an agent
  // there actually runs with is resolved backend-side, per session.
  systemPromptsList(arg: { scope: string }): Promise<PromptFileInfo[]>;
  systemPromptsSave(
    arg: { scope: string; kind: PromptFileKind; body: string },
  ): Promise<unknown>;
  systemPromptsDelete(
    arg: { scope: string; kind: PromptFileKind },
  ): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Library then
// shows a desktop-only note, same as prompts/extensions/skills/subagents.
export function systemPromptBindings(): SystemPromptBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as SystemPromptBindings) : null;
}
