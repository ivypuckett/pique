import { writable } from "svelte/store";
import { DEFAULT_SETTINGS, readConfig, type Settings, writeConfig } from "./bindings.ts";

// The daisyui themes compiled in app.css, in picker order. This list and the
// `themes:` list in src/app.css must stay in lockstep — one is the UI, the
// other is what's actually compiled.
export const THEMES: readonly string[] = [
  "catppuccin-frappe",
  "dark",
  "light",
  "dracula",
  "nord",
];

// Transient modal open/closed state — deliberately not persisted (unlike the
// `settings` store below), so a reload never reopens the modal.
export const settingsOpen = writable(false);

// Reactive user prefs. Starts at defaults so the UI can render before the async
// hydrate from ~/.pique/settings.json resolves (call hydrateSettings() at startup).
export const settings = writable<Settings>(DEFAULT_SETTINGS);

// Guards the persist subscription: the hydrating set() below must not immediately
// write back (and a pre-hydrate default must not clobber the file before we read).
let hydrated = false;

export async function hydrateSettings(): Promise<void> {
  const raw = await readConfig("settings");
  if (raw && typeof raw === "object") {
    // Per-section merge so a stored file missing a later-added field still picks
    // up its default, rather than a shallow spread dropping the whole section.
    const r = raw as Partial<Settings>;
    settings.set({
      version: DEFAULT_SETTINGS.version,
      appearance: { ...DEFAULT_SETTINGS.appearance, ...r.appearance },
      chat: { ...DEFAULT_SETTINGS.chat, ...r.chat },
    });
  }
  hydrated = true;
}

// Trailing-debounce persist, mirroring the layout store's 150ms writeback.
let timer: ReturnType<typeof setTimeout> | undefined;
settings.subscribe((s) => {
  if (!hydrated) return;
  clearTimeout(timer);
  timer = setTimeout(() => writeConfig("settings", s), 150);
});
