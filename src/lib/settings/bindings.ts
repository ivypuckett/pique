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
  // gitScanDepth: how many directory levels to descend looking for git repos when the
  // workspace root is not itself a repo, to highlight changed folders. Absent → the
  // resolveGitScanDepth default (see settings/file.ts).
  workspace: { defaultDir?: string; gitScanDepth?: number };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: { theme: "catppuccin-frappe" },
  chat: { defaultThinkingLevel: "off" },
  // gitScanDepth default mirrors resolveGitScanDepth's fallback in settings/file.ts
  // (separate module graph) — keep the two in sync.
  workspace: { gitScanDepth: 3 },
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

interface DialogBindings {
  pickDirectory(arg: { startDir?: string }): Promise<{ path: string } | null>;
}

// Opens the native folder picker via the desktop backend. Null in web-dev (no
// bindings) and on cancel — callers keep the current value in both cases.
export async function pickDirectory(startDir?: string): Promise<string | null> {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  const res = await (b as DialogBindings | undefined)?.pickDirectory({ startDir });
  return res?.path ?? null;
}
