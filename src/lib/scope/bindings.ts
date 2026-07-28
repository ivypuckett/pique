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
  // Statuses a fresh board in this scope is seeded with (see kanban/board.ts). Ids
  // are assigned at seed time, so only names are configured here.
  kanban?: { defaultStatuses?: { name: string }[] };
}

export interface ScopeBindings {
  // A scope's own config, with nothing inherited — what the settings UI edits.
  scopeConfigRead(arg: { scope: string }): Promise<ScopeConfig | null>;
  scopeConfigWrite(arg: { scope: string; data: ScopeConfig }): Promise<unknown>;
  // Root's config overlaid with the scope's — what an agent there actually sees.
  scopeConfigResolve(arg: { scope: string }): Promise<ScopeConfig | null>;
}

// Null in web-dev (deno task web), where there's no desktop backend — callers then
// run in-memory with no persistence, same as the chat bindings.
export function scopeBindings(): ScopeBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ScopeBindings) : null;
}
