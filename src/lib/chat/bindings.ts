// Frontend half of the chat binding contract. The backend half is the chat*
// win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by hand
// (separate module graphs, nothing cross-checks them at compile time).
import type { ChatEvent, ModelInfo, ThinkingLevel } from "./agent.ts";
export type { ChatEvent, ModelInfo, ThinkingLevel };

export interface ChatBindings {
  chatStart(): Promise<{ ok: true }>;
  chatPrompt(arg: { text: string }): Promise<unknown>;
  chatRead(): Promise<ChatEvent[]>;
  chatAbort(): Promise<unknown>;
  chatListModels(): Promise<ModelInfo[]>;
  chatSetModel(arg: { provider: string; id: string }): Promise<unknown>;
  chatSetThinking(arg: { level: ThinkingLevel }): Promise<unknown>;
}

export function chatBindings(): ChatBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ChatBindings) : null;
}
