// Frontend half of the config binding contract. The backend half is the config*
// win.bind handlers in src/desktop.ts, which delegate to settings/file.ts —
// keep arg/return shapes in sync by hand (separate module graphs).
import type { ThinkingLevel } from "../chat/agent.ts";

// The persisted user prefs, seeded from the config surfaces that already exist in
// code but weren't persisted (daisyui theme; chat model/provider/thinking). The
// layout tree persists separately under the "layout" config (see ../store.ts).
export interface Settings {
  version: number;
  appearance: { theme: string };
  chat: {
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinkingLevel?: ThinkingLevel;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: { theme: "catppuccin-frappe" },
  chat: {},
};

interface ConfigBindings {
  configRead(arg: { name: string }): Promise<unknown | null>;
  configWrite(arg: { name: string; data: unknown }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — callers
// then run in-memory with no persistence, same as the chat bindings.
function config(): ConfigBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ConfigBindings) : null;
}

export async function readConfig(name: string): Promise<unknown | null> {
  return (await config()?.configRead({ name })) ?? null;
}

export async function writeConfig(name: string, data: unknown): Promise<void> {
  await config()?.configWrite({ name, data });
}
