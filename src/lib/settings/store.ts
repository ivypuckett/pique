import { writable } from "svelte/store";
import {
  DEFAULT_SETTINGS,
  readConfig,
  type Settings,
  writeConfig,
} from "./bindings.ts";

// The theme list used to live here, in lockstep with the themes compiled into
// app.css. Themes are now editable data (see ./themes.ts): the picker reads the
// `themes` store, and app.css compiles none of them.

// UI scale factors, in order — the rungs ctrl+= / ctrl+- step between (App.svelte).
// A ladder rather than a fixed increment, so the steps stay proportional at both ends.
export const ZOOM_LEVELS: readonly number[] = [
  0.5,
  0.67,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
];

// The next rung up (+1) or down (-1) from `current`, which is not necessarily a rung
// itself — a settings file written by an older version has none, and one can be edited
// by hand — so snap to the nearest before stepping. Both ends clamp.
export function stepZoom(current: number, direction: 1 | -1): number {
  const nearest = ZOOM_LEVELS.reduce((best, z) =>
    Math.abs(z - current) < Math.abs(best - current) ? z : best
  );
  const i = ZOOM_LEVELS.indexOf(nearest) + direction;
  return ZOOM_LEVELS[Math.min(Math.max(i, 0), ZOOM_LEVELS.length - 1)];
}

// Transient modal open/closed state — deliberately not persisted (unlike the
// `settings` store below), so a reload never reopens the modal.
export const settingsOpen = writable(false);

// Reactive user prefs. Starts at defaults so the UI can render before the async
// hydrate from ~/.pique/settings.json resolves (call hydrateSettings() at startup).
export const settings = writable<Settings>(DEFAULT_SETTINGS);

// Guards the persist subscription: the hydrating set() below must not immediately
// write back (and a pre-hydrate default must not clobber the file before we read).
let hydrated = false;

// What a settings file may actually hold: sections are partial too, since one written
// before a field existed simply lacks it — `Partial<Settings>` only says the section
// itself may be missing.
type StoredSettings = { [K in keyof Settings]?: Partial<Settings[K]> };

// Per-section merge so a stored file missing a later-added field still picks up
// its default, rather than a shallow spread dropping the whole section. Pure, so
// the merge is unit-testable without the async hydrate.
export function mergeSettings(raw: StoredSettings): Settings {
  return {
    version: DEFAULT_SETTINGS.version,
    appearance: { ...DEFAULT_SETTINGS.appearance, ...raw.appearance },
    workspace: { ...DEFAULT_SETTINGS.workspace, ...raw.workspace },
    models: { ...DEFAULT_SETTINGS.models, ...raw.models },
  };
}

export async function hydrateSettings(): Promise<void> {
  const raw = await readConfig("settings");
  if (raw && typeof raw === "object") {
    settings.set(mergeSettings(raw as StoredSettings));
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
