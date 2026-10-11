// Frontend half of the system-prompt-files binding contract. The backend half is the
// systemPrompts* win.bind handlers in src/desktop.ts (delegating to prompts/system.ts)
// — keep arg/return shapes in sync by hand (separate module graphs).
//
// Type-only import: prompts/system.ts is Deno-side, and erasing the import is what keeps
// it out of the webview bundle.
import type { PromptFileInfo, PromptFileKind } from "./system.ts";
export type { PromptFileInfo, PromptFileKind };

// Unlike every other Library kind these are SINGLETONS: one SYSTEM.md and one
// APPEND_SYSTEM.md, addressed by kind rather than by name. There is nothing to create
// and nothing to name — `systemPromptsSave` writes whichever of the two you point it
// at, and saving an empty body deletes the file (prompts/system.ts says why).
export interface SystemPromptBindings {
  // Both files, present or not — always two entries.
  systemPromptsList(): Promise<PromptFileInfo[]>;
  systemPromptsSave(
    arg: { kind: PromptFileKind; body: string },
  ): Promise<unknown>;
  systemPromptsDelete(arg: { kind: PromptFileKind }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Library then
// shows a desktop-only note, same as prompts/extensions/skills.
export function systemPromptBindings(): SystemPromptBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as SystemPromptBindings) : null;
}
