# Settings Modal (v1: Appearance / theme) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VS Code-style settings modal with a single, fully-live
Appearance section whose theme picker switches the whole app (UI + terminal) and
persists to `~/.pique/settings.json`.

**Architecture:** A daisyui `<dialog class="modal">` component reads/writes the
existing `settings` store; the store already debounces writes to
`~/.pique/settings.json` and `main.ts` already applies `appearance.theme` to
`<html data-theme>` live. A TopBar gear button and a `Ctrl+,` shortcut in
`App.svelte` toggle a transient `settingsOpen` store. The daisyui theme list in
`app.css` is expanded so the picker has real options.

**Tech Stack:** Deno, Svelte 5 (runes), daisyui 5 / Tailwind 4, Vite.

---

## File Structure

- `src/lib/settings/store.ts` (modify) — add `THEMES` constant and
  `settingsOpen` writable.
- `src/lib/settings/store_test.ts` (create) — unit test for `THEMES` invariants.
- `src/app.css` (modify) — compile the curated daisyui theme list.
- `src/lib/settings/SettingsModal.svelte` (create) — the modal + Appearance
  section.
- `src/lib/TopBar.svelte` (modify) — gear button that opens the modal.
- `src/App.svelte` (modify) — `Ctrl+,` shortcut and mount the modal.

Persistence, hydration, and `data-theme` application already exist (see the
storage-mechanism work) and are **not** touched.

---

### Task 1: `THEMES` constant and `settingsOpen` store

**Files:**

- Modify: `src/lib/settings/store.ts`
- Test: `src/lib/settings/store_test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/settings/store_test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { DEFAULT_SETTINGS } from "./bindings.ts";
import { THEMES } from "./store.ts";

Deno.test("THEMES has no duplicates", () => {
  assertEquals(new Set(THEMES).size, THEMES.length);
});

Deno.test("THEMES includes the default theme", () => {
  assert(THEMES.includes(DEFAULT_SETTINGS.appearance.theme));
});

Deno.test("THEMES leads with catppuccin-frappe", () => {
  assertEquals(THEMES[0], "catppuccin-frappe");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A src/lib/settings/store_test.ts` Expected: FAIL — `THEMES` is
not exported from `store.ts` (module resolution / undefined export error).

- [ ] **Step 3: Add the constant and the open-state store**

In `src/lib/settings/store.ts`, after the existing `import` line and before
`export const settings`, add:

```ts
// The daisyui themes compiled in app.css, in picker order. This list and the
// `themes:` list in src/app.css must stay in lockstep — one is the UI, the
// other is what's actually compiled.
export const THEMES = [
  "catppuccin-frappe",
  "dark",
  "light",
  "dracula",
  "nord",
] as const;

// Transient modal open/closed state — deliberately not persisted (unlike the
// `settings` store below), so a reload never reopens the modal.
export const settingsOpen = writable(false);
```

`writable` is already imported at the top of the file
(`import { writable } from "svelte/store";`). Do not add a second import.

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test -A src/lib/settings/store_test.ts` Expected: PASS — 3 tests
pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings/store.ts src/lib/settings/store_test.ts
git commit -m "feat(settings): add THEMES list and settingsOpen store"
```

---

### Task 2: Compile the curated theme list in app.css

**Files:**

- Modify: `src/app.css`

- [ ] **Step 1: Expand the daisyui `themes` list**

In `src/app.css`, replace this block:

```css
@plugin "daisyui" {
  themes: "catppuccin-frappe"; /*dark --default, light;*/
}
```

with:

```css
@plugin "daisyui" {
  themes: "catppuccin-frappe", dark, light, dracula, nord;
}
```

Leave the
`@plugin "daisyui/theme" { name: "catppuccin-frappe"; default: true; ... }`
block below it exactly as-is — `catppuccin-frappe` stays the default; `dark`,
`light`, `dracula`, and `nord` are daisyui built-ins pulled in by name.

- [ ] **Step 2: Verify the build compiles all themes**

Run: `deno run -A npm:vite build` Expected: build succeeds. Confirm the built
CSS contains the new themes:

Run:
`grep -o 'data-theme=\(dracula\|nord\|light\|dark\)' dist/assets/*.css | sort -u`
Expected: lines for `dracula`, `nord`, `light`, and `dark` are present.

- [ ] **Step 3: Commit**

```bash
git add src/app.css
git commit -m "feat(settings): compile curated daisyui theme set"
```

---

### Task 3: SettingsModal component

**Files:**

- Create: `src/lib/settings/SettingsModal.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/settings/SettingsModal.svelte`:

```svelte
<script lang="ts">
  import { settings, settingsOpen, THEMES } from "./store.ts";

  // Bridge the boolean store to the native <dialog>: showModal()/close() are
  // imperative, so an effect drives them from settingsOpen, and the dialog's
  // own close event (Esc, backdrop) writes back to the store.
  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if ($settingsOpen && !dialog.open) dialog.showModal();
    else if (!$settingsOpen && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} class="modal" onclose={() => settingsOpen.set(false)}>
  <div class="modal-box max-w-lg overflow-hidden p-0">
    <div class="flex items-center justify-between border-b border-base-300 bg-base-200 px-4 py-3">
      <span class="text-base font-medium">Settings</span>
      <button
        class="btn btn-square btn-ghost btn-sm"
        aria-label="Close settings"
        onclick={() => settingsOpen.set(false)}
      >✕</button>
    </div>
    <div class="p-5">
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Appearance</div>
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm">Theme</div>
          <div class="mt-0.5 text-xs opacity-70">Applies to the whole app, including the terminal.</div>
        </div>
        <select
          class="select select-bordered select-sm min-w-44"
          aria-label="Theme"
          bind:value={$settings.appearance.theme}
        >
          {#each THEMES as t (t)}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button aria-label="Close settings">close</button>
  </form>
</dialog>
```

Notes for the implementer:

- `bind:value={$settings.appearance.theme}` writes back through the `settings`
  store, which triggers the existing debounced `writeConfig` and the
  `data-theme` subscription in `main.ts` — no extra wiring needed here.
- The `<form method="dialog" class="modal-backdrop">` is daisyui's standard
  backdrop; clicking it closes the dialog, firing `onclose`.

- [ ] **Step 2: Verify it type-checks via the build**

Run: `deno run -A npm:vite build` Expected: build succeeds with no Svelte/TS
errors. (The component isn't mounted yet, so nothing renders — this step only
confirms it compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings/SettingsModal.svelte
git commit -m "feat(settings): add SettingsModal with live theme picker"
```

---

### Task 4: Wire the gear button, the Ctrl+, shortcut, and mount the modal

**Files:**

- Modify: `src/lib/TopBar.svelte`
- Modify: `src/App.svelte`

- [ ] **Step 1: Add the gear button to TopBar**

In `src/lib/TopBar.svelte`, change the import line:

```svelte
import { activeView, activeWorkspace, focusView, resetView, toggleCollapse } from "./store.ts";
```

to also import the open-state store:

```svelte
import { activeView, activeWorkspace, focusView, resetView, toggleCollapse } from "./store.ts";
import { settingsOpen } from "./settings/store.ts";
```

Then, in the right-hand control cluster, add a gear button immediately after the
`Reset` button (after its closing `</button>`, still inside the same
`<div class="flex items-center gap-1">`):

```svelte
<button
  class="btn btn-ghost btn-sm"
  aria-label="Open settings"
  onclick={() => settingsOpen.set(true)}
>⚙</button>
```

- [ ] **Step 2: Add the Ctrl+, shortcut in App.svelte**

In `src/App.svelte`, inside `onKeydown`, find the existing `ctrl+b` block:

```ts
// ctrl+b: toggle a side column of the presented view (shift = right).
if (e.code === "KeyB") {
  e.preventDefault();
  e.stopPropagation();
  toggleCollapse(activeId(), e.shiftKey ? "right" : "left");
}
```

Immediately after that `if` block (still inside `onKeydown`, after the `!mod`
guard so it only runs with the modifier held), add:

```ts
// ctrl+,: open the settings modal. A plain shortcut, not a chord — it
// sits past the chord branch so it never arms or consumes a mode.
if (e.code === "Comma") {
  e.preventDefault();
  e.stopPropagation();
  settingsOpen.set(true);
}
```

- [ ] **Step 3: Import settingsOpen and mount the modal in App.svelte**

In `src/App.svelte`, add these imports to the `<script>` block (place next to
the other `./lib/...` imports):

```ts
import SettingsModal from "./lib/settings/SettingsModal.svelte";
import { settingsOpen } from "./lib/settings/store.ts";
```

Then mount the modal in the template. Change:

```svelte
    <StatusBar {chordMode} />
  </main>
</div>
```

to:

```svelte
    <StatusBar {chordMode} />
  </main>
  <SettingsModal />
</div>
```

- [ ] **Step 4: Verify the build compiles**

Run: `deno run -A npm:vite build` Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/TopBar.svelte src/App.svelte
git commit -m "feat(settings): open modal via gear button and Ctrl+,"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `deno test -A src/` Expected: all tests pass (the 3 new `store_test.ts`
tests plus the existing suite).

- [ ] **Step 2: Verify the desktop backend still bundles**

Run:
`deno run -A npm:vite build && deno desktop -A --include dist --output /tmp/pique-verify src/desktop.ts`
Expected: exit 0, "Bundle" line printed. Then clean up:
`rm -rf /tmp/pique-verify*`.

- [ ] **Step 3: Driven check (run the app)**

Launch with `deno task dev`. Then:

- Click the ⚙ gear in the top bar → the Settings modal opens.
- Close it (X, `Esc`, and backdrop click each work), reopen with `Ctrl+,`.
- Switch the Theme select through each option. For each, confirm: the UI
  restyles immediately, and the terminal pane repaints its colors.
- Pay special attention to `light` — the terminal's ANSI palette is derived from
  daisyui semantic vars in `src/lib/terminal/theme.ts` and was tuned against
  dark themes. If text is low-contrast or invisible on `light`, note it as a
  follow-up (do not fix here — it's out of scope per the spec).

- [ ] **Step 4: Verify persistence across restart**

With the app still running (or after), inspect the file:

Run: `cat ~/.pique/settings.json` Expected: JSON containing
`"appearance": { "theme": "<the last theme you selected>" }`.

Then relaunch `deno task dev` and confirm the app starts in that theme (no flash
of frappe if you'd chosen something else).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

If steps 1-4 required no code changes, there's nothing to commit — the feature
is complete. Otherwise commit the fixups with a descriptive message.

---

## Notes

- No component-level unit tests: the repo tests pure `.ts` logic only, and the
  modal is thin Svelte glue over already-tested stores. Task 5's driven check is
  the verification for the UI behavior.
- If binding `$settings.appearance.theme` in the `<select>` ever stops
  persisting, check that the `settings` store's `hydrated` flag is true (writes
  are suppressed pre-hydration by design) — but at runtime hydration completes
  before mount in `main.ts`, so this should not occur.
