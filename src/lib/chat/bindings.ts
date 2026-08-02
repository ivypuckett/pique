// Frontend half of the chat binding contract. The backend half is the chat*
// win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by hand
// (separate module graphs, nothing cross-checks them at compile time).
import type { ChatEvent, CommandInfo, Item, ModelInfo, ThinkingLevel } from "./agent.ts";
import type { ExtInfo, ExtSearchResult } from "./extensions.ts";
import type { ProviderInfo } from "./providers.ts";
export type { ChatEvent, CommandInfo, ExtInfo, ExtSearchResult, Item, ModelInfo, ProviderInfo, ThinkingLevel };

// Each Chat module gets its own backend agent, addressed by the id chatStart
// returns; every other call carries that id. `scope` is the workspace the module
// lives in — it decides which tools, defaults and board the agent gets.
//
// `profile` names the profile to start under: omitted means "the scope's default",
// "" means "no profile". The distinction is load-bearing — see chat/agent.ts. `fresh`
// abandons the scope's saved conversation and starts a new one instead of resuming it.
export interface ChatBindings {
  chatStart(arg: { cwd?: string; scope?: string; profile?: string; fresh?: boolean }): Promise<{ id: string }>;
  chatHistory(arg: { id: string }): Promise<Item[]>;
  chatPrompt(arg: { id: string; text: string }): Promise<unknown>;
  chatRead(arg: { id: string }): Promise<ChatEvent[]>;
  chatAbort(arg: { id: string }): Promise<unknown>;
  chatStop(arg: { id: string }): Promise<unknown>;
  chatListModels(arg: { id: string }): Promise<ModelInfo[]>;
  chatListCommands(arg: { id: string }): Promise<CommandInfo[]>;
  chatSetModel(arg: { id: string; provider: string; model: string }): Promise<unknown>;
  chatSetThinking(arg: { id: string; level: ThinkingLevel }): Promise<unknown>;
}

export function chatBindings(): ChatBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ChatBindings) : null;
}

// Pi-extension (pi package) management, backed by the ext* handlers in desktop.ts.
// Keyed by scope, not by chat id: packages install into one scope's agent dir, so
// installing in root serves every workspace and installing in a workspace serves
// only it. Search is scope-free (it queries npm).
export interface ExtBindings {
  extList(arg: { scope: string }): Promise<ExtInfo[]>;
  extSearch(arg: { query: string }): Promise<ExtSearchResult[]>;
  extInstall(arg: { scope: string; source: string }): Promise<unknown>;
  extRemove(arg: { scope: string; source: string }): Promise<unknown>;
}

export function extBindings(): ExtBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ExtBindings) : null;
}

// Model-provider management, backed by the provider* handlers in desktop.ts.
// Global (not keyed by a chat id): providers are a per-machine set shared with
// the `pi` CLI. Connecting/adding takes effect on chat agents without a restart.
export interface ProviderBindings {
  providerList(): Promise<ProviderInfo[]>;
  providerConnect(arg: { id: string; apiKey: string }): Promise<unknown>;
  providerDisconnect(arg: { id: string }): Promise<unknown>;
  providerAddCustom(arg: { id: string; baseUrl: string; apiKey?: string; models: string[] }): Promise<unknown>;
  providerRemoveCustom(arg: { id: string }): Promise<unknown>;
}

export function providerBindings(): ProviderBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ProviderBindings) : null;
}
