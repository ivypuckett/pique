# Zellij-style Shortcut Bar

## Goal

Introduce a persistent bottom status bar that surfaces pique's keyboard
shortcuts, making the tmux-style `ctrl+h` chord (and `ctrl+b` columns) an
easy, discoverable concept — the way zellij's bottom bar teaches its modes.

## Behavior

The bar is **contextual**: it shows different content depending on whether
the `ctrl+h` chord is armed (`chordPending`).

```
IDLE:
  ⌃H  workspace      ⌃B  columns

ARMED (after ⌃H):
  WORKSPACE   n new   w close   h ◄   l ►   esc cancel
```

- **Idle** lists the two leader keys. **Armed** swaps to the workspace
  group's sub-commands, prefixed with a highlighted `WORKSPACE` mode label
  (the zellij "you are in a mode now" cue).
- Display-only. Actions stay keyboard-driven; the top bar already provides
  clickable buttons for columns and view switching.

## Components

### `src/lib/StatusBar.svelte` (new)

- Props: `chordPending: boolean`.
- Full-width footer, `shrink-0`, styled to match `TopBar.svelte`
  (`border-t border-base-300 bg-base-200`, `text-xs`, key caps via daisyui
  `kbd`).
- Armed sub-commands come from a small local `{ key, label }[]` array
  rendered with `{#each}`; idle is two inline leader chips. No abstraction
  beyond that.
- Platform-aware leader label: `⌃H`/`⌃B` on non-Mac, `⌘H`/`⌘B` on Mac,
  computed locally the same way `App.svelte` does (`navigator.userAgent`).

### `src/App.svelte` (edit)

- Render `<StatusBar {chordPending} />` after `<Workspace />` inside `main`
  (already `flex flex-col`).
- The `chordPending` state and the chord handling already exist — no changes
  to the chord logic. `esc` already cancels the chord (it falls through to
  the handler's default branch), so `esc cancel` is accurate.
- Stop passing `chordPending` to `TopBar`.

### `src/lib/TopBar.svelte` (edit)

- Remove the now-redundant `{#if chordPending}` armed-state hint and the
  `chordPending` prop it uses. The bottom bar owns the armed-state display.

## Non-goals

- No clickable key caps.
- No changes to the chord/keybinding logic itself.
- No new keybindings.

## Verification

The repo has no Svelte component-test infrastructure (tests cover logic
only), so verification is:

1. `deno task build` typechecks and builds clean.
2. Run the app: confirm the idle bar shows both leaders, and pressing
   `ctrl+h` flips the bar to the workspace sub-commands.
