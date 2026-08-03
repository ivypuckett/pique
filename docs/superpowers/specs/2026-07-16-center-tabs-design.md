# Center Tabs — Design

## Summary

Let the center column hold multiple **tabs**, each a switchable module, with a
tab strip for navigation, a `+` module picker to add tabs, and per-tab close.
Inactive tabs stay mounted (hidden) so a backgrounded terminal keeps its running
process, scrollback, and session.

This is distinct from the side columns' existing pattern: sides split into 1–2
stacked **rows** (a vertical split); the center **switches** between N tabs. The
two patterns coexist unchanged.

## Goals

- Center column supports N tabs, switchable via a tab strip.
- `+` opens a module picker (choose kind from the registry) to add a tab.
- Each tab can be closed; the center always keeps at least one tab.
- Switching tabs preserves the inactive module's live state (terminal stays
  alive).

## Non-goals

- Reordering tabs (drag-to-reorder).
- Tabs in the side columns (they keep the row-split pattern).
- Moving modules between columns, or splitting the center into rows.
- Renaming tabs.

## Data model — `src/lib/layout.ts`

Add one field to `ColumnState`:

```ts
export interface ColumnState {
  widthPct: number;
  collapsed: boolean;
  savedWidthPct: number;
  rows: ModuleRef[]; // center: the tab list (N); sides: row split (1–2)
  rowSplitPct: number; // unused for center
  activeTabId: string; // NEW — meaningful only for center; sides carry it for shape uniformity
}
```

- The center's `rows` array becomes the ordered **tab list**. It was always
  length 1; it can now be any length ≥ 1.
- `activeTabId` names the visible center tab. For the side columns it is set (to
  `rows[0].id`) but never read.
- `createInitialView()` sets `activeTabId` on all three columns to their
  `rows[0].id`. The center starts with its single existing
  `{ id: "center-1", title: "Terminal",
  kind: "terminal" }` tab, active.

### New pure reducers

All follow the existing immutable `(v, ...) => ViewState` style, tested in
`layout_test.ts`.

- `addTab(v: ViewState, kind: string): ViewState`
  - Appends `{ id, title, kind }` to `center.rows` and sets `center.activeTabId`
    to the new id.
  - `title` is the module's display label (e.g. `"Terminal"`), derived from
    `kind`. Duplicate titles are allowed.
  - New id is unique within `center.rows`: use the smallest `center-N` not
    already present (deterministic, test-friendly).

- `setActiveTab(v: ViewState, tabId: string): ViewState`
  - Sets `center.activeTabId` to `tabId`. No-op if `tabId` is not a current
    center tab.

- `closeTab(v: ViewState, tabId: string): ViewState`
  - Removes `tabId` from `center.rows`.
  - **No-op when only one tab remains** — the center always has ≥ 1 tab.
  - If the closed tab was active, activate its neighbor: the previous tab if one
    exists, otherwise the next.

### Validation & persistence

- `isColumnState` gains a `typeof col.activeTabId === "string"` check. `rows`
  already requires length ≥ 1, which still holds.
- Bump the storage key `pique.layout.v2` → `pique.layout.v3` in `store.ts`. The
  shape changed (new required field); old persisted layouts are ignored and
  defaults load, rather than relying on validation to silently reject them.

## Store — `src/lib/store.ts`

- Bump `KEY` to `"pique.layout.v3"`.
- Add thin wrappers over `view.update`, mirroring the existing ones:
  - `addTab(kind: string): void`
  - `closeTab(tabId: string): void`
  - `setActiveTab(tabId: string): void`

## Rendering

### `src/lib/TabStrip.svelte` (new, focused component)

- Props: the center `ColumnState` (tabs + `activeTabId`), and callbacks
  (`onSelect`, `onClose`, `onAdd`) — or it imports the store actions directly,
  matching how `Column.svelte` already imports store actions.
- Renders one button per tab (daisyui tab styling), highlighting the active tab.
  Clicking a tab selects it.
- Each tab shows a `×` close control. It is disabled (or hidden) when only one
  tab remains.
- A trailing `+` button opens a dropdown (daisyui `dropdown`) listing the module
  kinds from `registry` (`Object.keys(registry)` → `terminal`, `placeholder`),
  each with a display label. Choosing one calls `addTab(kind)`.

### `src/lib/Column.svelte`

Branch on column id:

- **Center**: render `<TabStrip>`, then a container in which **every** tab's
  module is mounted, each wrapped in its existing `ModuleFrame` (per the chosen
  "tabs above the frame" layout — the frame keeps its own header). Inactive tabs
  are hidden with `display:none` (e.g. `class:hidden`), **never removed from the
  DOM**. Only the active tab is visible.
- **Sides**: unchanged — the existing collapsed rail / row-split path.

The center no longer uses the row-split grid; it uses a simple `flex flex-col`
(tab strip on top, tab bodies filling the rest).

## Correctness risk: terminal keep-alive

`Terminal.svelte`'s `onMount` cleanup kills the PTY on unmount. Keep-alive
therefore depends on inactive tabs being hidden via CSS while remaining mounted:

- Inactive tab modules must stay in the DOM (`display:none`), so
  `onMount`/cleanup does not fire on tab switch and the PTY survives.
- On re-show, the terminal's `ResizeObserver` fires (0×0 → real size) and
  refits, so dimensions stay correct.

**Manual verification:** start a long-running process (e.g. `top`) in tab A,
add/switch to tab B, switch back to A — confirm the process is still running,
scrollback intact, and the terminal is sized to the pane.

## Testing

- Unit tests in `layout_test.ts` for `addTab`, `setActiveTab`, `closeTab`:
  - `addTab` appends and activates; generates a unique id.
  - `setActiveTab` switches; no-op on unknown id.
  - `closeTab` removes; no-op at one tab; reactivates a neighbor when the active
    tab is closed.
  - `isViewState` accepts the new shape and (still) rejects a column missing
    `activeTabId`.
- Manual verification of terminal keep-alive as described above.

## Defaults chosen (overridable)

- Close control per tab, disabled at one tab.
- New-tab title is the module's plain name; duplicates allowed.
