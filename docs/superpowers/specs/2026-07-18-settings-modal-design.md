# Settings Modal (v1: Appearance / theme)

## Goal

Give pique a settings surface. v1 is deliberately minimal: a VS Code-style modal
with a single **Appearance** section whose one control — a theme picker — is
fully live. It consumes the `~/.pique/settings.json` storage mechanism that
already landed, proving that path end-to-end.

Everything the modal shows works. No inert placeholder sections.

## Scope

**In:**

- A modal opened by a TopBar gear button and the `Ctrl+,` shortcut.
- One Appearance section: a `Theme` label + description and a `<select>`.
- Live theme switching across the whole app (UI + terminal).
- Expanding the compiled daisyui theme list so the picker has real options.

**Out (deliberately deferred):**

- Left nav rail — with one section it would be a single inert item. It arrives
  with the second section (Chat/Terminal/Layout/About).
- Any Chat, Terminal, Layout, or About settings.
- Font / density / radius controls.

## Behavior

- The gear button and `Ctrl+,` both open the modal. `Ctrl+,` is a plain shortcut
  handled alongside the existing `App.svelte` keydown listener; it does **not**
  go through the `ctrl+h`/`ctrl+j` chord machinery.
- The modal closes on the X button, `Esc`, and backdrop click (all native
  `<dialog class="modal">` behavior in daisyui).
- Open/closed is transient UI state, not persisted.
- Changing the theme writes `settings.appearance.theme` through the existing
  settings store, which debounces a `writeConfig("settings", …)` to
  `~/.pique/settings.json`. The `data-theme` subscription already in `main.ts`
  applies the new value to `<html>` live. The terminal repaints because
  `terminal/theme.ts` re-derives its xterm palette from the daisyui semantic CSS
  variables.

## Components

### `src/lib/settings/SettingsModal.svelte` (new)

- A daisyui `<dialog class="modal">`; header "Settings" + close X; body is the
  Appearance section.
- Appearance section: label "Theme" with a one-line description on the left, a
  `<select>` on the right, bound to `$settings.appearance.theme`.
- The `<select>` options come from a local `THEMES` constant (see below).
- Styled to match existing chrome (`bg-base-200` header, `border-base-300`),
  consistent with `TopBar.svelte`.
- Owns no persistence logic — it only reads/writes the `settings` store from
  `src/lib/settings/store.ts`.

### Open state

- A module-level `writable<boolean>` `settingsOpen` exported from
  `src/lib/settings/store.ts`, toggled by the gear button and the `Ctrl+,`
  handler, and driving the `<dialog>`'s open state. Kept out of the persisted
  `settings`/`session` stores.

### `src/lib/settings/store.ts` (existing — add `THEMES`)

- Add an exported `THEMES: readonly string[]` constant listing the compiled
  themes, in picker order:
  `["catppuccin-frappe", "dark", "light", "dracula", "nord"]`.
- This is the single source the `<select>` iterates and the compiled `app.css`
  list must match. A unit test asserts `DEFAULT_SETTINGS.appearance.theme` is a
  member of `THEMES`.

### `src/lib/TopBar.svelte` (existing — add gear)

- A ghost gear button using a unicode glyph (`⚙`) to match the existing
  unicode-glyph buttons (`◧ ◨`) — pique has no icon font. Sets `settingsOpen`
  true. Placed in the right-hand control cluster.

### `src/lib/App.svelte` (existing — add shortcut)

- In the existing capture-phase `onKeydown`, add: if `mod && e.key === ","`,
  `preventDefault` and open the modal. Placed with the other non-chord shortcuts
  (e.g. the `ctrl+b` handling), before/outside the chord branch so it never arms
  or consumes a chord.

### `src/app.css` (existing — compile more themes)

- Expand `@plugin "daisyui" { themes: … }` to include `catppuccin-frappe`
  (remains `default`), `dark`, `light`, `dracula`, `nord`. `catppuccin-frappe`
  stays defined via its existing `@plugin "daisyui/theme"` block; the others are
  daisyui built-ins referenced by name.

## Testing / Verification

- **Unit:** assert `THEMES` includes the default theme and has no duplicates.
  The rest of the settings persistence is already covered by
  `settings/file_test.ts`.
- **Build:** `deno task test`, `vite build`, and the `deno desktop` bundle all
  stay green.
- **Driven check (manual/verify skill):** open the modal via gear and via
  `Ctrl+,`; switch to each theme; confirm `<html data-theme>` updates, the UI
  restyles, and the terminal repaints. Pay attention to the `light` theme — it
  is the most likely to expose a poor ANSI mapping in `terminal/theme.ts`
  (dark-on-dark or low-contrast slots). If it looks wrong, note it; fixing the
  ANSI derivation is a follow-up, not part of this spec.
- **Persistence:** after switching, confirm `~/.pique/settings.json` contains
  the chosen theme and it survives a restart.

## Non-goals / Risks

- Only `catppuccin-frappe` has hand-tuned colors; the daisyui built-ins are used
  as-is. Acceptable for v1 — the point is proving live switching.
- The terminal theme derivation was designed against a dark theme. The `light`
  option is the known risk; see the driven check above.
