# Pique File Tree Module — Design

**Date:** 2026-07-19 **Status:** Approved (pre-implementation)

## Purpose

Add a **file tree** module that lives in the top-left slot, is navigated with
vim-style keys, and opens a chosen file in `$EDITOR` as a new terminal tab in
the center column. This is the first module that **acts on another column** — it
proves a cross-module action path (a module reaching the layout store to open,
and a module closing itself), which the layout shell and terminal milestones
deliberately left untouched.

## Scope

**In:**

- A `filetree` module rendered in the left column's first row, seeded on boot.
- Nested, expandable tree (NERDTree-style): directories expand inline; one flat
  list of visible rows.
- Vim-style navigation, **read-only** (no file mutation).
- A backend `listDir` binding (lazy, one directory per expand).
- Opening a file launches `$EDITOR <file>` in a **new center terminal tab**;
  quitting the editor **auto-closes that tab**.

**Out (deferred, all additive):** file operations (create/rename/delete/move),
`.gitignore` filtering, filesystem watching, multi-root trees, reusing a single
editor tab, a hide-dotfiles toggle (all files are shown).

## Concept model fit

A file tree is a **Module** under the existing registry interface, registered as
`filetree` in [registry.ts](../../../src/lib/modules/registry.ts) and rendered
inside the existing `ModuleFrame` chrome, exactly like `terminal` and
`placeholder`. Its root directory is the `cwd` prop modules already receive (the
workspace working-directory override).

The editor tab it opens is an ordinary `terminal` module — no new "editor"
module kind. The terminal is parameterized (`argv`, `autoCloseOnExit`) so
"editor" is just a configured terminal, and the file path flows through as
**data**, never a shell-quoted string.

## Architecture

### 1. The `filetree` module (frontend)

`src/lib/filetree/FileTree.svelte` + a pure `src/lib/filetree/tree.ts`.

- **Tree model (`tree.ts`, unit-tested, no DOM):** nodes are
  `{ name, path, isDir, isSymlink, expanded, children? }`. Pure functions:
  - `sortEntries(entries)` — directories first, then files, each alphabetical
    (case-insensitive).
  - `flatten(tree)` — depth-first list of currently **visible** rows (a dir's
    children appear only when `expanded`), each carrying its depth for
    indentation.
  - `expand`/`collapse`/`setChildren` at a path — return a new tree.
  - Cursor movement helpers operate on the flattened list (an index).
- **Rendering:** the flattened rows as an indented list; the cursor row
  highlighted. Directories show an expand/collapse affordance; symlinks are
  visually marked.
- **Data loading (lazy):** expanding a directory with no loaded `children` calls
  `listDir(path)`, sorts, and sets them. Collapsing keeps loaded children (cheap
  re-expand). `R` refresh re-reads every currently-expanded directory.
- **Focus:** keybindings are active only when the tree pane holds focus (a
  focusable container with a keydown handler), so `j`/`k` don't fight other
  panes.
- **No bindings (browser tab):** if the `listDir` binding is absent, render an
  "unavailable — run the desktop app" state, mirroring `Terminal.svelte`.

**Keybindings** (tree focused):

| Key           | Action                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| `j` / `k`     | cursor down / up (over visible rows)                                    |
| `l` / `Enter` | expand directory, **or** open file in `$EDITOR`                         |
| `h`           | collapse directory; if already collapsed (or on a file), move to parent |
| `gg` / `G`    | first / last visible row                                                |
| `R`           | refresh (re-read expanded directories)                                  |

### 2. Backend: `listDir` binding

Mirrors the terminal's backend split.

- `src/lib/fs.ts` — a plain, unit-testable `listDir(path): Promise<Entry[]>`
  where `Entry = { name, path, isDir, isSymlink }`. Uses `Deno.readDir`.
  Symlinks are reported (`isSymlink`) but **not** resolved/followed here (avoids
  expansion loops).
- `src/desktop.ts` — register `win.bind("listDir", …)` **before** `Deno.serve`,
  per the established order-sensitive wiring rule (see
  [[deno-desktop-bindings-window-adoption]]). Handler is `async`, coerces the
  path arg, returns the entry array.
- `src/lib/filetree/bindings.ts` — typed frontend wrapper around
  `globalThis.bindings.listDir`, returning `undefined` when bindings are absent
  (browser tab), so the module can show its unavailable state.

### 3. Cross-module wiring — opening `$EDITOR` (the new machinery)

Three coordinated changes let the tree open a tab elsewhere and let that tab
close itself.

**(a) `ModuleRef` gains an optional payload** — `src/lib/layout.ts`:

```ts
export interface ModuleRef {
  id: string;
  title: string;
  kind: string;
  props?: { argv?: string[]; autoCloseOnExit?: boolean };
}
```

Backward compatible: existing refs have no `props`. `Column.svelte` spreads it
into the module:
`<Module title={…} {cwd} {viewId} tabId={ref.id} {...ref.props} />`.

**(b) Store action `openEditor`** — `src/lib/store.ts` + a layout helper:

- `openEditor(viewId, path)` adds a **center** `terminal` tab, titled with the
  file's basename, carrying
  `props: { argv: ["$EDITOR", path], autoCloseOnExit: true }`, and activates it.
- **Editor resolution is backend-side and sentinel-based.** The frontend never
  hardcodes an editor: it sets `argv[0]` to the literal string `"$EDITOR"` as a
  sentinel. When `termStart` receives an `argv` whose first element is
  `"$EDITOR"`, the backend replaces it with `Deno.env.get("EDITOR") ?? "vi"`
  before spawning. Any other `argv` is spawned verbatim. This keeps editor
  resolution in one backend place and the frontend editor-agnostic.

**(c) Terminal parameterization + self-close** — `src/lib/terminal/`:

- `pty.ts` / `termStart` accept optional `argv`; default remains the interactive
  `$SHELL` (fallback `bash`). With `argv`, spawn that command in the PTY at the
  given size/cwd.
- `Terminal.svelte` accepts `argv`, `autoCloseOnExit`, and now also `viewId` +
  `tabId`. Passes `argv` through to `termStart`. When the read loop reaches
  `done`:
  - if `autoCloseOnExit`: call `closeTab(viewId, tabId)` (a module closing
    **itself**),
  - else: current behavior — print `[session ended]` and stop.
- Shell tabs (no `autoCloseOnExit`) are unchanged: `exit` still shows
  `[session ended]`.

**Thread `viewId` (and `tabId`) into modules** — `src/lib/Column.svelte` already
has `viewId` in scope and each `ref.id` is the tab id; pass both to `<Module>`
in all three column branches. The registry component type gains optional
`viewId?`/`tabId?`. This is the one intrusive change (every module's prop
signature grows), and it is the seam that makes both "open in center" and
"self-close" possible.

### 4. Default placement

`createInitialView` seeds the left column's first row as `filetree` instead of
`placeholder`; `left-2` stays a placeholder. A fresh workspace shows the tree
top-left on launch.

## Data flow (open a file)

1. Tree focused, cursor on a file, user presses `Enter`/`l`.
2. `FileTree.svelte` calls `openEditor(viewId, node.path)`.
3. Store adds a center `terminal` tab:
   `{ kind: "terminal", title: basename,
   props: { argv: ["$EDITOR", path], autoCloseOnExit: true } }`,
   activates it.
4. `Column.svelte` renders `Terminal.svelte` with those props +
   `viewId`/`tabId`.
5. `termStart({ cols, rows, cwd, argv })` → backend resolves `"$EDITOR"` →
   spawns the editor in the PTY.
6. User edits; on `:q` the PTY exits → `termRead` resolves `done`.
7. `autoCloseOnExit` → `Terminal.svelte` calls `closeTab(viewId, tabId)`; the
   tab disappears and a neighbor activates.

## Error handling

- **`listDir` failure** (permission denied, path vanished): the wrapper rejects;
  the module shows the directory as empty/errored inline and keeps the rest of
  the tree usable. No crash.
- **Bindings absent** (browser tab): "unavailable" state; navigation keys are
  inert.
- **Editor spawn failure** (bad `$EDITOR`): the PTY exits immediately with
  `done`; with `autoCloseOnExit` the tab closes — acceptable for this cut (a
  follow-up could surface spawn errors before auto-closing).
- **Symlink loops:** avoided by not following symlinks for expansion.

## Files

```
src/lib/layout.ts                 # ModuleRef.props; openEditor layout helper; left-1 default → filetree
src/lib/store.ts                  # openEditor(viewId, path) action
src/lib/Column.svelte             # thread viewId + tabId + ref.props into every <Module>
src/lib/modules/registry.ts       # register `filetree`; component type gains viewId?/tabId?
src/lib/filetree/
  FileTree.svelte                 # NEW tree UI + vim navigation + focus handling
  tree.ts                         # NEW pure tree model (sort/flatten/expand/collapse/cursor) — unit-tested
  tree_test.ts                    # NEW
  bindings.ts                     # NEW typed listDir wrapper
src/lib/fs.ts                     # NEW backend listDir (Deno.readDir) — unit-testable
src/lib/fs_test.ts                # NEW
src/desktop.ts                    # register listDir binding (before Deno.serve)
src/lib/terminal/pty.ts           # termStart accepts optional argv
src/lib/terminal/bindings.ts      # argv in termStart signature
src/lib/terminal/Terminal.svelte  # argv, autoCloseOnExit, viewId, tabId; self-close on done
```

No new frontend dependencies. Backend uses `Deno.readDir` (already permitted;
`--allow-read` is in the dev/build permission set — confirm during
implementation).

## Success criteria

1. App launches → a file tree renders in the top-left slot, rooted at the
   workspace cwd.
2. `j`/`k` move the cursor; `l`/`Enter` expands a directory (children load
   lazily and are sorted dirs-first alphabetical); `h` collapses / walks to
   parent.
3. `gg`/`G` jump to first/last visible row; `R` refreshes expanded directories.
4. `Enter`/`l` on a file opens a new center tab running `$EDITOR <file>`, titled
   with the file's basename, and activates it.
5. Quitting the editor (`:q`) auto-closes that center tab and activates a
   neighbor.
6. A plain shell terminal tab is unaffected: `exit` still shows
   `[session ended]` and stays open.
7. In a browser tab (no bindings) the tree shows an "unavailable" state and does
   not crash.
8. Unit tests pass for `tree.ts` (sort/flatten/expand/collapse/cursor bounds)
   and `fs.ts` (`listDir` returns entries with correct `isDir`/`isSymlink`;
   missing path errors).

## Verification

- **Unit:** `tree.ts` model functions and `fs.ts` `listDir` under `deno test`,
  no webview.
- **Backend integration (headless):** drive `listDir` against a temp directory
  tree (mkdir/symlink/files → assert sorted entries) — mirrors the terminal's
  headless PTY test pattern.
- **Manual/visual:** launch the app; exercise the full navigate → open → `:q` →
  tab-close loop, plus a shell tab's unchanged `exit` behavior and the
  browser-tab unavailable state, against the success criteria.

## Decisions on record

- **Choosing a file opens a new center tab per file** (not a reused editor tab).
  (User decision, 2026-07-19.)
- **Quitting `$EDITOR` auto-closes its tab**; shell tabs keep `[session ended]`.
  Achieved via an `autoCloseOnExit` flag on the tab and the terminal module
  closing itself. (User decision.)
- **`$EDITOR` runs via an extended `termStart` `argv`**, not a `$SHELL -c`
  wrapper — path flows as data, no shell quoting. Editor resolution is
  backend-side. (User decision.)
- **Nested expandable tree** (not netrw single-directory drill). (User
  decision.)
- **Read-only** this milestone; file operations deferred. (User decision.)
- **All files shown** — no dotfile hiding/toggle, no `.gitignore` parsing this
  cut. (User decision.)
- **Lazy `listDir`, dirs-first alphabetical, manual `R` refresh, symlinks listed
  but not followed, no filesystem watching.** (User decision.)
- **Boots with the tree in the top-left slot** (`createInitialView` left-1 →
  `filetree`). (User decision.)
- **Modules gain `viewId`/`tabId` props and `ModuleRef` gains `props`** — the
  intrusive but necessary seam enabling cross-module open and module self-close.
