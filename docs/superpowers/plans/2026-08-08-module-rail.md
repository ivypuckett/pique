# Module rail plan

**Tracking lives on the ws-1 Kanban board** (six cards, `plan: module-rail`),
not in this file's checkboxes. This document is the shared context every card
points at: read it once per session, then work the card. It is not a
superpowers plan — no sub-skill required.

**Goal:** the right pane stops being a flat strip of freely duplicated modules.
Module *selection* moves to a vertical rail on the right edge (the workspace
rail's twin, mirrored); modules that may exist more than once (terminal only)
get a horizontal tab strip above the content; and the file explorer becomes a
rail entry that always shows the tree with its open editors beside it.

```
 ┌────────┬──────────────────┬──────────┐   rail (right edge): one row per module
 │        │ 1 zsh │ 2 build │+│ Explorer │   strip (top): the selected row's tabs
 │  chat  ├──────────────────┤ Terminal◄│   content: the strip's active tab
 │        │                  │ Git Diff │
 │        │     content      │ Kanban   │   Explorer's own strip is its editors,
 │        │                  │ Library  │   with the file tree pinned to its left
 │        │                  │Automatons│
 └────────┴──────────────────┴──────────┘
```

## Decisions (asked and answered 2026-08-08)

1. **Instance tabs go in a horizontal strip on top**, not nested in the rail.
   The rail selects a module *group*; the strip lists that group's open tabs.
2. **The Explorer entry holds the tree plus editor tabs.** Opening a file
   (`l`/`⏎` in the tree → `$EDITOR`) or a per-file diff (`g d`) opens a tab
   *inside* the Explorer group. Editors never appear in the rail.
3. **Terminal is the only duplicable module.** Git Diff, Kanban, Library and
   Automatons are singletons: selecting one reveals the instance that exists
   instead of adding another. That is the bug this work starts from.

Follow-on decisions taken while planning (change them if you disagree, but say
so on the card):

- **Singleton means per-view, not per-workspace.** Two side-by-side views may
  each show Kanban; that is two panes on one screen, not a duplicate. Enforcing
  workspace-wide uniqueness would mean the second view could not show the board
  at all, which is worse.
- **Select-or-create.** Choosing a rail row with no open tab creates one (this
  is how `ctrl+t k` behaves today). Explorer is the exception — its tree is the
  content, so it opens with zero tabs.
- **An empty group stays selected.** Closing a group's last tab does not jump
  elsewhere; the content area shows a short empty state. Falling back to
  another group would resurrect terminals nobody asked for.
- **The rail lives inside the right pane**, to the right of the content, so
  `ctrl+shift+b` (collapse) still hides selection and content together, and the
  chat/pane splitter is untouched.
- **The rail is always visible when the pane is open** — no separate hide
  toggle. `ctrl+b` stays the workspace rail's.

## Where things are today

| File | Role now |
| --- | --- |
| `src/lib/layout.ts` | `ViewState` = chat width + `center` + `right` (`ColumnState`: `collapsed`, `rows: ModuleRef[]`, `activeTabId`) + `explorer` (`widthCh`, `hidden`). All tab reducers live here, pure. |
| `src/lib/store.ts` | Svelte stores + one thin wrapper per reducer, view-addressed via `edit(viewId, fn)`. |
| `src/lib/workspace.ts`, `src/lib/session.ts` | Views inside a workspace; workspaces inside the session. `isViewState`/`isWorkspaceState`/`isSessionState` guard the persisted tree; `migrateSession` adopts pre-root layouts. |
| `src/lib/View.svelte` | The chat \| splitter \| right-pane grid. |
| `src/lib/Column.svelte` | Renders chat for `center`; for `right`, the `TabStrip` above a grid of [docked explorer · splitter · stacked tab contents]. Every tab stays mounted; inactive ones are `display:none`. |
| `src/lib/TabStrip.svelte` | Horizontal strip: explorer toggle button, one chip per `col.rows` entry, `+` dropdown listing every registry kind, collapse button. |
| `src/lib/modules/registry.ts` | `Record<kind, Component>` — nothing else. |
| `src/App.svelte` | The single capture-phase keydown listener: the `ctrl+h`/`ctrl+j`/`ctrl+t` chords, `ctrl+e`, `ctrl+b`, `ctrl+,`, zoom. Also `settleFocus`, `focusActiveTab`, `visibleTree`. |
| `src/lib/StatusBar.svelte` | Hardcoded duplicate of every chord's key list. |
| `src/lib/filetree/FileTree.svelte` | Calls `openEditor(viewId, path)` (`l`/`⏎`) and `openDiff(viewId, path)` (`g d`). |

Module metadata is scattered across four places today: labels in `layout.ts`
(`LABELS`/`moduleLabel`), the pickable set in `TabStrip.svelte` (`registry`
keys minus chat and filetree), chord letters in `App.svelte`, and the same
letters again in `StatusBar.svelte`. The rail needs a fifth (row order,
duplicability), so task 1 collapses them into one table.

## Target model

`ModuleRef` gains a `group` — the rail row a tab belongs to. It is the tab's
`kind` for ordinary modules, and `"explorer"` for editors and per-file diffs,
which is what puts them inside the Explorer entry while still rendering a
`terminal`/`gitdiff` component.

```ts
export interface ModuleRef {
  id: string;
  title: string;
  kind: string;   // component key in the registry
  group: string;  // rail row; defaults to kind
  props?: { argv?: string[]; autoCloseOnExit?: boolean; autoFocus?: boolean; path?: string };
}

export interface RightState {
  collapsed: boolean;
  activeGroup: string;                 // selected rail row
  tabs: ModuleRef[];                   // every open tab, all groups, in open order
  activeTabs: Record<string, string>;  // group → visible tab id (per-group memory)
}

export interface ViewState {
  id: string;
  chatWidthCh: number;
  center: ColumnState;    // chat; unchanged
  right: RightState;
  explorerWidthCh: number; // an `explorer: { widthCh, hidden }` object until task 5
}
```

`ExplorerState` outlived task 3 as it was and became a bare `explorerWidthCh` in task 5,
where `hidden` died with the docked addon — splitting it earlier would have left a
one-field interface standing for two tasks. Both older shapes are migrated; see
Persistence below, which is where that decision came back to bite.

Why per-group `activeTabs` rather than one `activeTabId`: switching to Terminal
should land on the terminal you were last in, not reset to the first.

Invariants worth asserting in tests:

- `activeTabs[g]` names a tab whose `group === g`, or is absent when the group
  is empty.
- `activeGroup` is a rail row from the manifest (never a bare `kind` that has
  no row, never `""`).
- At most one tab per singleton group.
- The tab strip renders `tabs.filter(t => t.group === activeGroup)` in array
  order; `1`-`9` and `h`/`l` index that filtered list, not `tabs`.

## Target key map (`ctrl+t`)

| Key | Action | Sticky |
| --- | --- | --- |
| `e` | select Explorer (replaces `ctrl+e`) | no |
| `t` `g` `k` `b` `a` | select Terminal / Git Diff / Kanban / Library / Automatons — reveal, never duplicate | no |
| `n` | new tab in the selected group (Terminal only; no-op for singletons) | no |
| `j` / `k` | previous / next **rail row** | yes |
| `h` / `l` | previous / next **tab** in the selected group | yes |
| `1`-`9` | nth tab of the selected group | yes |
| `w` | close the selected tab | yes |
| `⏎` | settle focus, exit the mode | — |

`j`/`k` for the vertical rail and `h`/`l` for the horizontal strip mirrors
`ctrl+j`'s `k`/`j` (vertical workspaces) and `ctrl+h`'s `h`/`l` (horizontal
views). `n` for "new" matches `ctrl+h n` and `ctrl+j n`.

`ctrl+e` is **deleted** — no deprecation period. The three-state cycle it drove
(reveal → focus → hide) goes with it: the tree is always present in the
Explorer group, so `ctrl+t e` selects the group and focuses the tree.

## Focus rules (do not regress these)

`App.svelte`'s `settleFocus` runs after every chord stroke and does two things:
blurs a caret left inside a pane that is now `display:none`, and focuses a
terminal that has just come on screen. Terminals only — `focusActiveTab` grabs
a pane's first focusable element, which for Kanban is a column's rename field,
so focusing everything would let a stray keystroke rename a column.

Two consequences for this work:

- The rail-row check in `settleFocus` must read the newly selected group's
  active tab (`kind === "terminal"`), not `right.activeTabId`, which is gone.
- `ctrl+t e` should focus the tree (the old `ctrl+e` behaviour) — that is an
  explicit case, not something `settleFocus` does for you.

## Persistence and migration

The tree persists to `~/.pique/layout.json` (debounced 150ms in `store.ts`).
`isViewState` rejects the old shape, and a rejected root makes `migrateSession`
return `null`, which silently resets **every workspace, its cwd overrides and
its views** back to defaults. That is a real loss for a daily driver, so task 3
carries a view-level migration:

- `right.rows` → `tabs`, each with `group = kind`.
- Extra tabs of a singleton kind are dropped, keeping the first.
- `right.activeTabId` → `activeGroup` (that tab's kind) + `activeTabs`.
- `explorer.widthCh` → `explorerWidthCh`; `explorer.hidden` is discarded.

**There are two old shapes, not one.** Tasks 3 and 5 each changed the persisted
view, so a layout written by a build in between carries a *grouped* pane
(`tabs`/`activeGroup`/`activeTabs`) beside the *old* `explorer` object. A
`migrateView` that insists on `right.rows` rejects it, and the app then boots on
defaults and persists them over the user's workspaces on the next keystroke —
this happened, and it is why `migrateView` reads `tabs` or `rows`, keeps a group
a tab already names, and keeps a `activeGroup`/`activeTabs` pair it is given
(dropping remembered ids whose tab is gone or has changed group).

The lesson generalises: when a task changes the persisted shape, teach
`migrateView` the shape the *previous* task wrote, not just the original.

Boards, sessions and settings live elsewhere on disk and are untouched.

## Verification

- `deno task test` — the pure reducers (`layout_test.ts`, `workspace_test.ts`,
  `session_test.ts`, `store_test.ts`) are where the model work is proved. Add
  cases with the tasks; do not leave the old `rows` assertions rewritten into
  vacuous ones.
- `deno run -A npm:vite build` — Svelte 5 compile check for the components.
- Manual, in web mode: read `docs/agent-verification.md` first (screenshots hang
  in this pane; drive with `javascript_tool`/`form_input`, read back with
  `read_page`). The layout shell, chords and rail all work in web mode; the
  terminal, chat and tree bodies need the desktop app (`deno task dev`, which
  needs `WEBKIT_DISABLE_DMABUF_RENDERER=1` — already set in the task).

## Docs to update when the behaviour lands (task 6)

- `docs/keybindings.md` — the chord table, the sticky/one-shot section, the
  "Plain shortcuts" section (drop `ctrl+e`), and the `settleFocus` prose.
- `docs/agent-verification.md` — its shortcut list names `ctrl+e`.
- `CLAUDE.md` needs nothing.

## Non-goals

- No change to chat, the center column, or the chat/pane splitter.
- No rail hide/show toggle of its own, no rail width drag, no drag-to-reorder
  tabs, no tab overflow scrolling beyond what flex already does.
- No new modules, and no change to what any module renders.
- Editors stay `$EDITOR`-in-a-terminal; this does not build a text editor.

---

## Task 1 — One module manifest

Collapse the four scattered copies of module metadata into one table, so the
rail, the chord, the strip and the status bar read the same source.

**Files:** `src/lib/modules/registry.ts` (extend), `src/lib/layout.ts`
(`moduleLabel` delegates, `LABELS` goes), `src/lib/TabStrip.svelte`,
`src/App.svelte`, `src/lib/StatusBar.svelte`.

```ts
export type ModuleDef = {
  kind: string;
  label: string;       // rail row, tab title, picker entry
  key: string;         // ctrl+t <key>
  duplicable?: boolean;
  component: Component<...>;
};
// Rail order = array order. Chat is not in it (center column).
export const MODULES: ModuleDef[] = [...];
export const registry: Record<string, Component<...>>; // keep, derived from MODULES
```

Explorer is not a component, so it is *not* a `MODULES` entry in this task —
task 5 decides whether it joins the array as a special row or sits ahead of it.
Keep `registry` exported and keyed the same way: `Column.svelte` and
`Kanban`/`Library` lookups depend on it.

**Verify:** `deno task test` green; `ctrl+t t/g/k/b/a` still open tabs and the
`+` dropdown still lists the same five kinds in web mode. Pure refactor — no
behaviour change.

## Task 2 — Stop duplicating singletons

The reported bug, fixed on the *current* model so it ships without waiting for
the rail.

**Files:** `src/lib/layout.ts` (`addTab`), `src/lib/layout_test.ts`.

`addTab(v, kind)` looks for an existing tab of a non-duplicable kind; if one
exists it makes it active and returns (no new tab). Terminal keeps appending.
Editors and diffs go through `addEditorTab`/`addDiffTab` and are not affected.

**Verify:** new tests — "addTab reveals the existing kanban tab instead of
adding one", "addTab appends a second terminal". In web mode, `ctrl+t k k k`
leaves one Kanban tab, selected.

## Task 3 — Right-pane groups

The model change: `RightState` as specified above, the reducers, and the
migration. The visible arrangement stays as-is apart from the strip now
listing only the selected group's tabs.

**Files:** `src/lib/layout.ts`, `src/lib/store.ts`, `src/lib/Column.svelte`,
`src/lib/TabStrip.svelte`, `src/lib/View.svelte`, `src/App.svelte`,
`src/lib/layout_test.ts`.

Reducers to land (all pure, all in `layout.ts`): `groupTabs` and `activeTabId`
(the two accessors everything else reads), `addTab` (singleton rule from task 2,
now expressed over groups), `closeTab` (maintains `activeTabs`, leaves an empty
group selected), `focusAdjacentTab` / `focusTabAt` (over the filtered list),
`setActiveTab` (crosses groups, since revealing a singleton does),
`addEditorTab` / `addDiffTab` (both `group: "explorer"`), `isViewState` for the
new shape, and `migrateView` for the old one.

`selectGroup` and `focusAdjacentGroup` belong to task 4, not here: nothing calls
them until the rail exists, and the rail is what defines row order.

The docked explorer and `explorer.hidden` survive this task untouched — moving
the tree is task 5, and the `"explorer-tabs"` boundary keeps its name.

Migration is a chain, one function per level, each mirroring that level's guard:
`migrateView` (layout.ts) → `migrateWorkspace` (workspace.ts) → `migrateSession`
(session.ts), which now also composes with the older pre-root adoption it
already did. Migrating has to happen *before* the guards run, since
`isWorkspaceState` calls `isViewState`.

**Verify:** `deno task test` (the migration deserves its own tests: an old
`ViewState` JSON in, a valid new one out, with a duplicate Kanban dropped, and a
session keeping its workspaces and cwd overrides). Web mode has no config
persistence, so prove the real file separately: back up
`~/.pique/layout.json`, then run it through `migrateSession` in a scratch script
and check the workspaces, cwds and shown tab all survive.

## Task 4 — The rail

**Files:** new `src/lib/ModuleRail.svelte`, `src/lib/Column.svelte`,
`src/lib/TabStrip.svelte`, plus `selectGroup` and `focusAdjacentGroup` in
`layout.ts` (deferred from task 3, which had no caller for them) and their
wrappers in `store.ts`. `selectGroup` is select-or-create: choosing a row whose
group has no tabs opens one, which is how `ctrl+t k` already behaves. Rail order
is `MODULES` order, and task 5 puts Explorer at its head.

The rail is `WorkspacePane.svelte` mirrored: fixed width, full height of the
right pane, `border-l` instead of `border-r`, one `menu` row per `MODULES`
entry, `menu-active`/`font-medium` on the selected row, `aria-current="page"`,
`aria-label="Show {label}"`. Clicking a row calls `selectGroup`. It reads the
same `$session`-derived state the rest of the pane does, addressed by `viewId`.

The `+` dropdown leaves `TabStrip` (the rail is the picker now). What stays:
one chip per filtered tab, middle-click and `×` to close, and the `«` collapse
button. `+` becomes "new tab in this group", rendered only for a duplicable
group.

Content area gets the empty state for a group with no tabs: one centered line,
`text-sm opacity-60`, naming the group and the key that opens one.

**Verify:** `deno run -A npm:vite build`; then in web mode click every rail row
and confirm the strip and content follow, the selection survives a reload, and
`ctrl+shift+b` still collapses the whole pane including the rail.

## Task 5 — Explorer group

**Files:** `src/lib/layout.ts` (replace `ExplorerState` with a bare
`explorerWidthCh`, dropping `hidden` and `setExplorerHidden` — `migrateView`
carries the old width across), `src/lib/store.ts`, `src/lib/Column.svelte`,
`src/lib/ModuleRail.svelte`, `src/App.svelte` (`toggleFileTree`, `visibleTree`),
`src/lib/modules/registry.ts`.

The tree stops being a docked addon of the whole pane and becomes the left
column of the Explorer group only: `[tree · splitter · editor tabs]`, the
splitter still driving `explorerWidthCh` through the `"explorer-tabs"`
boundary. Every other group uses the pane's full width. The explorer toggle
button (`◧`) goes away with `hidden`.

Explorer is the first rail row. Its strip lists its editor and diff tabs; with
none open, the tree simply has the pane to itself (no empty-state line — the
tree *is* the content).

`FileTree.svelte` needs no change: `openEditor`/`openDiff` already carry
`viewId`, and task 3 gave them `group: "explorer"`.

**Verify:** desktop app (the tree needs the backend). Open two files and a
`g d` diff, confirm three tabs in the Explorer strip with the tree still on the
left, close one, switch to Terminal and back, and confirm `autoCloseOnExit`
still removes an editor tab when `$EDITOR` exits.

## Task 6 — Chords, status bar, docs

**Files:** `src/App.svelte`, `src/lib/StatusBar.svelte`, `docs/keybindings.md`,
`docs/agent-verification.md`.

Implement the target key map above: add `e` and `n`, move `j`/`k` to the rail,
keep `h`/`l`/`1`-`9` on the strip, delete the `ctrl+e` branch and
`toggleFileTree`. Keep `visibleTree` — `ctrl+t e` focuses the tree with it.
Fix `settleFocus` to read the selected group's active tab. `StatusBar`'s `tab`
key list comes from the manifest plus the fixed navigation keys.

**Verify:** `deno task test`; in web mode walk the whole tab mode — `e`, `t`,
`n`, `j`/`k`, `h`/`l`, `1`-`9`, `w`, `⏎`, and `esc` — reading the status bar
back at each step, and confirm `ctrl+e` now does nothing. Then the desktop app
once for terminal focus: `ctrl+t n` must leave you typing in the new shell, and
`ctrl+t k` must not rename a Kanban column when you type after it.
