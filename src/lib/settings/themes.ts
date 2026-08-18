/// <reference lib="dom" />
// Every theme pique can show, and the <style> element that makes them real.
//
// There are no built-in themes: app.css asks daisyui for `themes: false`, and the six
// themes pique ships are SEEDS (seeds.ts) copied into ~/.pique/themes.json on first
// run. After that they are the user's, editable and deletable like any theme they
// paste in. One code path themes the app, so a hand-written theme is not a second-class
// one — which is the whole point of the format being daisyui's own (theme_css.ts).

import { writable } from "svelte/store";
import { readConfig, writeConfig } from "./bindings.ts";
import { settings } from "./store.ts";
import { SEED_THEMES } from "./seeds.ts";
import {
  parseThemeCss,
  peekThemeName,
  splitThemeSheet,
  type Theme,
  themeRule,
} from "./theme_css.ts";

// The editor stores the CSS text, not the parsed theme: it is what the user typed,
// comments and declaration order included, and re-emitting it from a parse tree would
// quietly rewrite their file every time they opened it. `name` is the parsed name,
// carried alongside so the picker and the collision check need not re-parse.
export interface StoredTheme {
  name: string;
  css: string;
}

// The name the editor's live preview is applied under. The colon is what keeps it
// separate: theme_css.ts's name pattern rejects it, so no saved theme can ever be
// called this, while a quoted attribute selector takes it happily.
export const DRAFT_THEME = "pique:draft";

export const themes = writable<StoredTheme[]>([]);

export function seedThemes(): StoredTheme[] {
  return splitThemeSheet(SEED_THEMES).map((css) => ({
    name: parseThemeCss(css).name,
    css,
  }));
}

// A themes.json written by hand can be anything; anything unusable falls back to the
// seeds rather than leaving the app with no colors at all.
export function themesFromStored(raw: unknown): StoredTheme[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const list: StoredTheme[] = [];
  for (const item of raw) {
    const t = item as { name?: unknown; css?: unknown };
    if (typeof t?.name !== "string" || typeof t?.css !== "string") return null;
    list.push({ name: t.name, css: t.css });
  }
  return list;
}

// Save an edited or pasted theme. `originalName` is the theme being edited, or null for
// a new one — a rename is a save whose parsed name differs from it. Collisions are
// rejected rather than shadowed or auto-suffixed: two themes with one name would make
// the picker ambiguous and the selector a coin toss, and the user already has the
// theme they are trying to create.
export function saveTheme(
  list: StoredTheme[],
  originalName: string | null,
  css: string,
): StoredTheme[] {
  const theme = parseThemeCss(css);
  const clash = list.find((t) =>
    t.name === theme.name && t.name !== originalName
  );
  if (clash) {
    throw new Error(
      `a theme named "${theme.name}" already exists — edit that one, or rename this`,
    );
  }
  const entry = { name: theme.name, css };
  const at = originalName === null
    ? -1
    : list.findIndex((t) => t.name === originalName);
  if (at === -1) return [...list, entry];
  return list.map((t, i) => (i === at ? entry : t));
}

// The last theme cannot be deleted: nothing else would supply the custom properties
// the whole UI is built on, and an app with no theme is not a state worth having.
export function deleteTheme(
  list: StoredTheme[],
  name: string,
): StoredTheme[] {
  if (list.length <= 1) throw new Error("that is the only theme left");
  return list.filter((t) => t.name !== name);
}

// Put the shipped themes back the way a first run leaves them: a seed that was edited
// reverts to its seed text, one that was deleted returns, and the seeds lead the list in
// picker order. Themes the user wrote are not the factory's to reset — they are carried
// across untouched, after the seeds. A renamed seed is one of those: the name it now has
// is not a seed's, so it stays and the original comes back beside it.
export function restoreDefaults(list: StoredTheme[]): StoredTheme[] {
  const seeds = seedThemes();
  const shipped = new Set(seeds.map((t) => t.name));
  return [...seeds, ...list.filter((t) => !shipped.has(t.name))];
}

// The text for a copy of `name`, renamed "<name>-copy" (or -copy-2, …). Text only, not
// a saved theme: the copy is a draft in the editor until the user saves it, so backing
// out of a duplicate leaves nothing behind.
export function duplicateCss(list: StoredTheme[], name: string): string {
  const source = list.find((t) => t.name === name);
  if (!source) throw new Error(`no theme named "${name}"`);
  let copy = `${name}-copy`;
  for (let n = 2; list.some((t) => t.name === copy); n++) {
    copy = `${name}-copy-${n}`;
  }
  return source.css.replace(
    /(^|[{;])(\s*)name\s*:\s*[^;]+/,
    `$1$2name: "${copy}"`,
  );
}

// One rule per theme that parses. A theme that does not parse is skipped rather than
// throwing: a single bad hand-edit in themes.json should cost that theme, not the app.
export function themesStyleText(list: StoredTheme[]): string {
  const rules: string[] = [];
  for (const t of list) {
    try {
      rules.push(themeRule(parseThemeCss(t.css)));
    } catch {
      // Surfaced in the editor, where the user can see and fix the text.
    }
  }
  return rules.join("\n\n");
}

// Rewrite (creating on first call) one <style> in <head>. Unlayered and appended after
// the bundle, so theme properties win over anything daisyui emits.
function writeStyle(id: string, css: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function applyThemes(list: StoredTheme[]): void {
  writeStyle("pique-themes", themesStyleText(list));
}

// The editor's live preview: the draft is injected under DRAFT_THEME and the document
// switched to it, so the whole app repaints as the text is edited. Re-setting
// data-theme on every keystroke is deliberate — the terminal and diff modules re-derive
// their palettes from a MutationObserver on that attribute (terminal/theme.ts), and an
// attribute write notifies them even when the value is unchanged.
export function previewTheme(theme: Theme): void {
  writeStyle("pique-theme-draft", themeRule({ ...theme, name: DRAFT_THEME }));
  document.documentElement.dataset.theme = DRAFT_THEME;
}

// Drop the preview and go back to the saved theme named by settings.
export function endPreview(active: string): void {
  writeStyle("pique-theme-draft", "");
  document.documentElement.dataset.theme = active;
}

// The active theme can vanish under the settings store — deleted here, renamed here, or
// removed by hand from themes.json — and a data-theme matching no rule leaves the app
// with none of the properties it is built on. Fall back to the first theme.
function reconcileActive(list: StoredTheme[]): void {
  settings.update((s) =>
    list.length > 0 && !list.some((t) => t.name === s.appearance.theme)
      ? { ...s, appearance: { ...s.appearance, theme: list[0].name } }
      : s
  );
}

let hydrated = false;

export async function hydrateThemes(): Promise<void> {
  const stored = themesFromStored(await readConfig("themes"));
  const list = stored ?? seedThemes();
  // Set before the guard opens, so the subscription below does not write the file back
  // the instant it is read; the apply and reconcile it would have done happen here.
  themes.set(list);
  applyThemes(list);
  reconcileActive(list);
  hydrated = true;
  // First run (or an unreadable file): put the seeds on disk, so the themes the app
  // shows and the file the user can edit are the same thing from the start.
  if (!stored) await writeConfig("themes", list);
}

themes.subscribe((list) => {
  if (!hydrated) return;
  applyThemes(list);
  void writeConfig("themes", list);
  reconcileActive(list);
});
