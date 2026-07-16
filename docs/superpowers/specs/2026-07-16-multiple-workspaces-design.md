# Multiple Workspaces — Design

## Summary

Add a **session** above the existing workspace: an ordered set of workspaces, exactly
one selected, navigated vertically with a `ctrl+j` chord (`j/k/n/w`). A fixed rail on
the far left lists the workspaces and marks the selected one. Each workspace carries an
auto-numbered title.

Today's `WorkspaceState` is already "an ordered set of views with one active" — which is
exactly what a workspace should be. It becomes a real workspace by gaining `id` and
`title`; the new `session.ts` sits above it as a structural sibling of `workspace.ts`.
`layout.ts` is untouched.

Workspaces do not tile as visible rows. "Vertical" describes the navigation axis (`j/k`)
and the rail's list order, mirroring how views navigate horizontally (`h/l`) today. Only
the selected workspace is on screen; the rest stay mounted and hidden, exactly as views
already do.

## Goals

- A session holds N workspaces; exactly one is selected. It always keeps at least one.
- `ctrl+j` enters workspace mode: `j` down, `k` up, `n` new, `w` close.
- A left rail lists workspaces by title and marks the selected one; clicking focuses.
- Each workspace has an auto-numbered title (`Workspace 1`, `Workspace 2`, …).
- Backgrounded workspaces keep their terminals alive, as backgrounded views do.

## Non-goals

- Renaming workspaces (titles are stored so rename can land later without migration).
- Reordering workspaces.
- Moving views between workspaces.
- Resizing or collapsing the rail.
- Migrating persisted `v4` layouts (see Persistence).

## Terminology

Three levels, each an ordered list with one active member:

```
SessionState   { workspaces: WorkspaceState[], activeId }   — new,  session.ts
  WorkspaceState { id, title, views: ViewState[], activeId } — +id, +title
    ViewState    { id, left, center, right }                 — unchanged
```

The `ctrl+h` chord is *labeled* "workspace" today but operates on views. Once real
workspaces exist that label is wrong, so it is renamed to **view** mode. Its keys
(`n/w/h/l`) and behavior do not change.

## Data model — `src/lib/workspace.ts`

`WorkspaceState` gains two fields:

```ts
export interface WorkspaceState {
  id: string;      // NEW — stable for the workspace's lifetime; keys the session list
  title: string;   // NEW — "Workspace N", assigned at creation
  views: ViewState[];
  activeId: string;
}
```

- `createInitialWorkspace(id = "ws-1", title = "Workspace 1"): WorkspaceState` — callers
  in `session.ts` pass both.
- `isWorkspaceState` gains `typeof obj.id === "string"` and `typeof obj.title ===
  "string"` checks.
- All other exports (`addView`, `closeView`, `focusAdjacent`, `focusView`, `updateView`)
  are unchanged — they spread `...w`, so the new fields carry through.

## Data model — `src/lib/session.ts` (new)

A structural sibling of `workspace.ts`, with the same rules one level up:

```ts
export interface SessionState {
  workspaces: WorkspaceState[];  // >= 1, ordered top-to-bottom in the rail
  activeId: string;              // names one of the workspaces
}
```

- `createInitialSession(): SessionState` — one workspace (`ws-1` / `"Workspace 1"`),
  active.
- `addWorkspace(s)` — appends a fresh workspace and activates it. The id is the smallest
  free `ws-N` (mirroring `nextViewId`); the title is `Workspace N` for that same N.
- `closeWorkspace(s)` — removes the active workspace, keeping at least one. Activates the
  previous neighbor if one exists, otherwise the next (matching `closeView`).
- `focusAdjacent(s, dir: -1 | 1)` — moves the active id one step; clamped at the ends, no
  wrap (matching `focusAdjacent` for views).
- `focusWorkspace(s, id)` — no-op for an unknown id.
- `updateWorkspace(s, id, fn)` — replaces one workspace via a workspace-level reducer.
- `isSessionState(s)` — structural guard: non-empty `workspaces` array, every element
  passing `isWorkspaceState`, and `activeId` naming one of them.

### Titles do not renumber

A title is assigned once from the smallest free number and never recomputed. Closing
`Workspace 2` of three and adding a new one yields ids `[ws-1, ws-3, ws-2]` and a rail
reading **1, 3, 2** top-to-bottom, because `addWorkspace` appends.

This is intended. The title is a *name* — stable for the workspace's lifetime and
renameable later — not a position. Renumbering would rename workspaces out from under the
user. Accepted for this milestone.

## Persistence — `src/lib/store.ts`

- Bump `KEY` from `"pique.layout.v4"` to `"pique.layout.v5"`. The top-level shape changed;
  old state is ignored and defaults load, matching how the center-tabs milestone handled
  its shape change.
- **No migration.** A stored `v4` workspace is not wrapped into a session. The cost is
  losing the current local layout once, on a pre-release app.

## Store — `src/lib/store.ts`

- `export const session = writable<SessionState>(load())` replaces the `workspace`
  writable. The debounced-save subscription is unchanged apart from the value it stores.
- Derived stores:
  - `activeWorkspace` — `s.workspaces.find((w) => w.id === s.activeId)!`
  - `activeView` — derived from `activeWorkspace`; same meaning as today.
- The view-scoped `edit(viewId, fn)` helper now routes through two levels: it updates the
  **active workspace**, then the named view within it. Every existing view-scoped action
  (`resizeBoundary`, `toggleCollapse`, `toggleRows`, `resizeRow`, `addTab`, `setActiveTab`,
  `closeTab`, `resetView`) keeps its current signature and behavior.
- View-level workspace actions (`addView`, `closeView`, `focusAdjacent`, `focusView`,
  `activeId`) keep their names and signatures, retargeted at the active workspace.
- New session-level actions: `addWorkspace()`, `closeWorkspace()`,
  `focusAdjacentWorkspace(dir)`, `focusWorkspace(id)`.

Naming note: `focusAdjacent` (views) and `focusAdjacentWorkspace` (workspaces) coexist in
the store. The asymmetry is deliberate — it keeps every existing call site untouched.

## Rendering

### `src/lib/WorkspacePane.svelte` (new)

- A fixed **180px** rail (Tailwind `w-45`), full height, on the far left of the app.
- A `WORKSPACES` header, then one button per workspace showing its title, with
  `btn-active` on the selected one (matching `TopBar`'s view switcher styling).
- Clicking a row calls `focusWorkspace(w.id)`.
- Always visible, even at one workspace. A rail that appeared and disappeared would
  reflow every terminal in the app — unlike `TopBar`'s view switcher, which is inline
  chrome and can hide at one view.
- `aria-pressed` on the selected row; `aria-label` per row, matching `TopBar`'s pattern.

### `src/lib/Session.svelte` (new)

All workspaces stay mounted; only the selected one is shown. This is the same
`absolute inset-0` + `class:hidden` pattern `Workspace.svelte` already uses for views,
applied one level up — so a backgrounded workspace's terminals keep running for the same
reason a backgrounded view's do.

### `src/lib/Workspace.svelte`

Takes a `workspace` prop instead of reading `$workspace` from the store. Its internals
are otherwise unchanged.

### `src/lib/TopBar.svelte`

Reads `$activeWorkspace` instead of `$workspace`. The view-number switcher and the
column-toggle/reset buttons are otherwise unchanged.

### `src/App.svelte`

The shell becomes a two-column flex: the rail, then the existing vertical stack beside it.

```
<div class="flex h-screen w-screen">
  <WorkspacePane />
  <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <TopBar /> <Session /> <StatusBar {chordMode} />
  </main>
</div>
```

## Keybindings — `src/App.svelte`

`chordPending: boolean` becomes `chordMode: "view" | "workspace" | null`. The sticky
semantics are unchanged: the mode stays armed across sub-commands, restarts its idle
timer on each one, and exits on `esc`, any unrecognized key, or 2s idle.

| Prefix   | Mode      | Keys                                        |
| -------- | --------- | ------------------------------------------- |
| `ctrl+h` | view      | `n` new, `w` close, `h` left, `l` right     |
| `ctrl+j` | workspace | `n` new, `w` close, `k` up, `j` down        |

- Both prefixes are swallowed (capture-phase `preventDefault` + `stopPropagation`) so
  they never reach the terminal, as `ctrl+h` already is.
- Pressing the *other* prefix while a mode is armed switches modes rather than being
  treated as an unrecognized key. `ctrl+j` then `ctrl+h` lands in view mode.
- `j`/`k` map to `focusAdjacentWorkspace(1)` / `focusAdjacentWorkspace(-1)`. Down is `+1`
  (later in the list, further down the rail).
- Modifier-only keydowns still don't cancel a pending chord.
- `ctrl+b` (column toggle) is unchanged.

## `src/lib/StatusBar.svelte`

Takes `chordMode` instead of `chordPending`. When a mode is armed it shows that mode's
badge and key list; when idle it shows the three prefixes (`⌃H` view, `⌃J` workspace,
`⌃B` columns).

## Testing

`src/lib/session_test.ts`, mirroring `workspace_test.ts`:

- `createInitialSession` has one workspace, active, titled `Workspace 1`.
- `addWorkspace` appends, activates, and titles the new workspace from its number.
- `addWorkspace` picks the smallest free `ws-N` id.
- `closeWorkspace` removes the active one and activates the previous neighbor.
- `closeWorkspace` activates the next neighbor when the first workspace is closed.
- `closeWorkspace` is a no-op at one workspace.
- `focusAdjacent` moves the active id and clamps at both ends.
- `focusWorkspace` is a no-op for an unknown id.
- `updateWorkspace` edits one workspace, leaving others untouched.
- `isSessionState` accepts real and round-tripped-through-JSON state; rejects `null`,
  `{}`, empty `workspaces`, and an `activeId` naming no workspace.
- Title stability: close and re-add, asserting the `1, 3, 2` ordering documented above.

Existing `workspace_test.ts` gains coverage for the new `id`/`title` fields in
`isWorkspaceState`; its other tests should pass unchanged.

**Manual verification:** run the app and confirm — `ctrl+j n` adds a workspace and the
rail grows; `ctrl+j j/k` moves the selection; `ctrl+j w` closes and selects a neighbor;
a terminal running `top` in workspace 1 is still running after switching to 2 and back;
`ctrl+h` still switches views within a workspace and the StatusBar labels it "view".

## Defaults chosen (overridable)

- Rail is 180px, fixed, always visible.
- No migration from `v4`; the current local layout is lost once.
- Titles never renumber (rail can read 1, 3, 2).
- Down (`j`) means later in the list.
