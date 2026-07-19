// Frontend half of the chat binding contract. The backend half is the chat*
// win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by hand
// (separate module graphs, nothing cross-checks them at compile time).
import type { ChatEvent, ModelInfo, ThinkingLevel } from "./agent.ts";
export type { ChatEvent, ModelInfo, ThinkingLevel };

// Each Chat module gets its own backend agent, addressed by the id chatStart
// returns; every other call carries that id.
export interface ChatBindings {
  chatStart(arg: { cwd?: string }): Promise<{ id: string }>;
  chatPrompt(arg: { id: string; text: string }): Promise<unknown>;
  chatRead(arg: { id: string }): Promise<ChatEvent[]>;
  chatAbort(arg: { id: string }): Promise<unknown>;
  chatStop(arg: { id: string }): Promise<unknown>;
  chatListModels(arg: { id: string }): Promise<ModelInfo[]>;
  chatSetModel(arg: { id: string; provider: string; model: string }): Promise<unknown>;
  chatSetThinking(arg: { id: string; level: ThinkingLevel }): Promise<unknown>;
}

export function chatBindings(): ChatBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ChatBindings) : null;
}
