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
import type {
  CustomProviderDetails,
  LoginStep,
  ModelOption,
  ProviderInfo,
} from "./providers.ts";
export type {
  ChatEvent,
  CommandInfo,
  Item,
  LoginStep,
  ModelInfo,
  ModelOption,
  ProviderInfo,
  ReloadSummary,
  ThinkingLevel,
};

// Each Chat module gets its own backend agent, addressed by the id chatStart
// returns; every other call carries that id. `workspace` and `view` name the pane the
// module lives in, and decide which conversation is resumed: one per view.
//
// `fresh` abandons the view's saved conversation and starts a new one instead of
// resuming it.
export interface ChatBindings {
  chatStart(
    arg: { cwd?: string; workspace?: string; view?: string; fresh?: boolean },
  ): Promise<{ id: string; thinking: ThinkingLevel }>;
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
// Global (not keyed by a chat id): providers are one set, in the agent dir. Connecting/adding takes effect on chat agents without a restart.
export interface ProviderBindings {
  providerList(): Promise<ProviderInfo[]>;
  // Every model those providers offer, for pickers with no chat session behind them
  // (the Settings model checklist). A live Chat module uses chatListModels instead, which also
  // marks the one it is currently on.
  providerModels(): Promise<ModelOption[]>;
  // A provider's login, driven one pi prompt at a time: start it, answer each step's
  // prompt, until a step comes back done. A rejected step is a failed login.
  providerLoginStart(arg: { id: string }): Promise<LoginStep>;
  providerLoginAnswer(arg: { value: string }): Promise<LoginStep>;
  providerLoginCancel(): Promise<unknown>;
  // The AWS region stored with Bedrock's credential; blank removes it (see
  // setBedrockRegion in providers.ts).
  providerSetBedrockRegion(arg: { region: string }): Promise<unknown>;
  providerDisconnect(arg: { id: string }): Promise<unknown>;
  providerAddCustom(
    arg: { id: string; baseUrl: string; apiKey?: string; models: string[] },
  ): Promise<unknown>;
  // A saved custom provider for editing; providerAddCustom with the same id saves it,
  // a blank apiKey keeping the one already there.
  providerGetCustom(arg: { id: string }): Promise<CustomProviderDetails>;
  providerRemoveCustom(arg: { id: string }): Promise<unknown>;
}

export function providerBindings(): ProviderBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ProviderBindings) : null;
}
