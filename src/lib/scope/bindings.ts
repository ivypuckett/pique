// Frontend half of the scoped-config binding contract. The backend half is the
// scopeConfig* win.bind handlers in src/desktop.ts (delegating to scope/config.ts) —
// keep arg/return shapes in sync by hand (separate module graphs).
import type { ThinkingLevel } from "../chat/agent.ts";

// One scope's OWN config — what it overrides, not what it inherits. Every field is
// optional: an absent one means "inherit from root", and root falling back to the
// compiled-in default. That is why this has no DEFAULT_ constant to merge against,
// unlike Settings — merging defaults in would erase the difference between "unset"
// and "deliberately the same as root".
export interface ScopeConfig {
  chat?: {
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinkingLevel?: ThinkingLevel;
  };
}

export interface ScopeBindings {
  // A scope's own config, with nothing inherited — written by a Chat module's model
  // and thinking pickers (scope/store.ts).
  scopeConfigRead(arg: { scope: string }): Promise<ScopeConfig | null>;
  scopeConfigWrite(arg: { scope: string; data: ScopeConfig }): Promise<unknown>;
  // Root's config overlaid with the scope's — what an agent there actually sees.
  scopeConfigResolve(arg: { scope: string }): Promise<ScopeConfig | null>;
  // The same, with the compiled-in fallbacks filled in: the model an agent in this
  // scope runs on when nothing overrides it. Every field is set, which is what makes
  // it printable — resolveConfig alone cannot say what an unset field means, because
  // the fallbacks live Deno-side in chat/agent.ts.
  scopeChatDefaults(
    arg: { scope: string },
  ): Promise<{ provider: string; modelId: string; thinking: ThinkingLevel }>;
}

// Null in web-dev (deno task web), where there's no desktop backend — callers then
// run in-memory with no persistence, same as the chat bindings.
export function scopeBindings(): ScopeBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ScopeBindings) : null;
}
