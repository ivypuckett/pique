// Frontend half of the chat binding contract. The backend half is the chat*
// win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by hand
// (separate module graphs, nothing cross-checks them at compile time).
import type {
  ChatEvent,
  CommandInfo,
  Item,
  ModelInfo,
  ReloadSummary,
  ThinkingLevel,
} from "./agent.ts";
import type { ModelOption, ProviderInfo } from "./providers.ts";
export type {
  ChatEvent,
  CommandInfo,
  Item,
  ModelInfo,
  ModelOption,
  ProviderInfo,
  ReloadSummary,
  ThinkingLevel,
};

// Each Chat module gets its own backend agent, addressed by the id chatStart
// returns; every other call carries that id. `scope` is the workspace the module
// lives in — it decides which tools, defaults and board the agent gets. `view` is
// the view inside it, and decides which conversation is resumed: one per view.
//
// `fresh` abandons the view's saved conversation and starts a new one instead of
// resuming it.
export interface ChatBindings {
  chatStart(
    arg: { cwd?: string; scope?: string; view?: string; fresh?: boolean },
  ): Promise<{ id: string }>;
  chatHistory(arg: { id: string }): Promise<Item[]>;
  chatPrompt(arg: { id: string; text: string }): Promise<unknown>;
  chatRead(arg: { id: string }): Promise<ChatEvent[]>;
  chatAbort(arg: { id: string }): Promise<unknown>;
  chatStop(arg: { id: string }): Promise<unknown>;
  chatListModels(arg: { id: string }): Promise<ModelInfo[]>;
  chatListCommands(arg: { id: string }): Promise<CommandInfo[]>;
  chatReloadPrompts(arg: { id: string }): Promise<unknown>;
  chatReload(arg: { id: string }): Promise<ReloadSummary>;
  chatSetModel(
    arg: { id: string; provider: string; model: string },
  ): Promise<unknown>;
  chatSetThinking(arg: { id: string; level: ThinkingLevel }): Promise<unknown>;
}

export function chatBindings(): ChatBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ChatBindings) : null;
}

// Model-provider management, backed by the provider* handlers in desktop.ts.
// Global (not keyed by a chat id): providers are a per-machine set shared with
// the `pi` CLI. Connecting/adding takes effect on chat agents without a restart.
export interface ProviderBindings {
  providerList(): Promise<ProviderInfo[]>;
  // Every model those providers offer, for pickers with no chat session behind them
  // (the automaton editor). A live Chat module uses chatListModels instead, which also
  // marks the one it is currently on.
  providerModels(): Promise<ModelOption[]>;
  providerConnect(arg: { id: string; apiKey: string }): Promise<unknown>;
  providerDisconnect(arg: { id: string }): Promise<unknown>;
  providerAddCustom(
    arg: { id: string; baseUrl: string; apiKey?: string; models: string[] },
  ): Promise<unknown>;
  providerRemoveCustom(arg: { id: string }): Promise<unknown>;
}

export function providerBindings(): ProviderBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ProviderBindings) : null;
}
