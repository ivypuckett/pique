# Multiple Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session above the existing workspace — N workspaces with
auto-numbered titles, one selected, navigated with a `ctrl+j` chord (`j/k/n/w`),
listed in a fixed left rail.

**Architecture:** Today's `WorkspaceState` is already "an ordered set of views
with one active", so it becomes a real workspace by gaining `id` and `title`. A
new `session.ts` sits above it as a structural sibling of `workspace.ts` with
the same seven pure reducers one level up. Rendering recurses the existing
pattern: `Session.svelte` keeps every workspace mounted and shows only the
selected one, exactly as `Workspace.svelte` already does for views, so
backgrounded terminals stay alive. `layout.ts` is untouched.

**Tech Stack:** Deno, Svelte 5 (runes), Tailwind + daisyui, xterm.js. Tests:
`deno task test` (`deno test -A src/`) with `@std/assert`.

**Design spec:**
`docs/superpowers/specs/2026-07-16-multiple-workspaces-design.md`

---

## File Structure

- `src/lib/workspace.ts` (modify) — add `id` and `title` to `WorkspaceState`;
  extend `createInitialWorkspace` and `isWorkspaceState`. Other reducers
  unchanged.
- `src/lib/workspace_test.ts` (modify) — cover the new fields.
- `src/lib/session.ts` (create) — `SessionState` and its seven pure reducers:
  `createInitialSession`, `addWorkspace`, `closeWorkspace`, `focusAdjacent`,
  `focusWorkspace`, `updateWorkspace`, `isSessionState`.
- `src/lib/session_test.ts` (create) — unit tests for all of the above.
- `src/lib/store.ts` (modify) — `session` writable replaces `workspace`; bump
  key to `v5`; add `activeWorkspace` derived; route `edit()` through two levels;
  add session-level actions.
- `src/lib/WorkspacePane.svelte` (create) — the fixed 180px left rail.
- `src/lib/Session.svelte` (create) — stacks all workspaces, shows the selected
  one.
- `src/lib/Workspace.svelte` (modify) — take a `workspace` prop instead of
  reading the store.
- `src/lib/TopBar.svelte` (modify) — read `$activeWorkspace` instead of
  `$workspace`.
- `src/App.svelte` (modify) — two-column shell; `chordMode` replaces
  `chordPending`; `ctrl+j` handler.
- `src/lib/StatusBar.svelte` (modify) — take `chordMode`; show per-mode key
  sets.

**Task order rationale:** Tasks 1–3 are pure state (fully unit-tested, no UI).
Tasks 4–7 are rendering and keybindings, verified by running the app. The app
will not compile between Task 3 and Task 6 — `store.ts` stops exporting
`workspace` while components still import it. Task 6 closes that. Do not stop
between 3 and 6.

---

## Task 1: `WorkspaceState` gains `id` and `title`

**Files:**

- Modify: `src/lib/workspace.ts`
- Test: `src/lib/workspace_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/workspace_test.ts` (imports `createInitialWorkspace`,
`isWorkspaceState` already exist at the top of the file):

```ts
Deno.test("createInitialWorkspace defaults to ws-1 / Workspace 1", () => {
  const w = createInitialWorkspace();
  assertEquals(w.id, "ws-1");
  assertEquals(w.title, "Workspace 1");
});

Deno.test("createInitialWorkspace takes an explicit id and title", () => {
  const w = createInitialWorkspace("ws-7", "Workspace 7");
  assertEquals(w.id, "ws-7");
  assertEquals(w.title, "Workspace 7");
  assertEquals(w.views.length, 1);
  assertEquals(w.activeId, "view-1");
});

Deno.test("isWorkspaceState rejects a workspace missing id or title", () => {
  const w = createInitialWorkspace();
  const { id: _id, ...noId } = w;
  const { title: _title, ...noTitle } = w;
  assertEquals(isWorkspaceState(noId), false);
  assertEquals(isWorkspaceState(noTitle), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno task test` Expected: FAIL — `createInitialWorkspace defaults to ws-1`
fails with `Values are not equal: undefined !== "ws-1"`.

- [ ] **Step 3: Add the fields**

In `src/lib/workspace.ts`, replace the `WorkspaceState` interface and
`createInitialWorkspace`:

```ts
// A workspace is an ordered set of views tiled horizontally with equal width. Exactly
// one view is "active" (the presented view); keyboard navigation moves the active id
// between neighbors, and view-level actions target it.
export interface WorkspaceState {
  id: string; // stable across the workspace's lifetime; keys the session list
  title: string; // "Workspace N", assigned at creation; never renumbered
  views: ViewState[]; // >= 1, tiled left-to-right
  activeId: string; // names one of the views
}

export function createInitialWorkspace(
  id = "ws-1",
  title = "Workspace 1",
): WorkspaceState {
  const view = createInitialView("view-1");
  return { id, title, views: [view], activeId: view.id };
}
```

Then extend the guard at the bottom of the same file:

```ts
export function isWorkspaceState(w: unknown): w is WorkspaceState {
  if (typeof w !== "object" || w === null) return false;
  const obj = w as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.title !== "string") return false;
  if (!Array.isArray(obj.views) || obj.views.length === 0) return false;
  if (!obj.views.every(isViewState)) return false;
  return typeof obj.activeId === "string" &&
    (obj.views as ViewState[]).some((v) => v.id === obj.activeId);
}
```

`focusAdjacent`, `focusView`, and `updateView` already spread `...w`, so the new
fields carry through — leave them untouched. `addView` and `closeView` rebuild
the object literally (`{ views, activeId }`), which would **drop `id` and
`title`**. Add the spread to both:

```ts
export function addView(w: WorkspaceState): WorkspaceState {
  const view = createInitialView(nextViewId(w.views));
  return { ...w, views: [...w.views, view], activeId: view.id };
}

export function closeView(w: WorkspaceState): WorkspaceState {
  if (w.views.length <= 1) return w;
  const idx = w.views.findIndex((v) => v.id === w.activeId);
  if (idx === -1) return w;
  const views = w.views.filter((v) => v.id !== w.activeId);
  const activeId = (views[idx - 1] ?? views[idx]).id;
  return { ...w, views, activeId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno task test` Expected: PASS — all `workspace_test.ts` tests green,
including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace.ts src/lib/workspace_test.ts
git commit -m "feat: give WorkspaceState an id and title"
```

---

## Task 2: `session.ts` — state, creation, and add

**Files:**

- Create: `src/lib/session.ts`
- Test: `src/lib/session_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/session_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { addWorkspace, createInitialSession } from "./session.ts";

Deno.test("createInitialSession has one workspace, active", () => {
  const s = createInitialSession();
  assertEquals(s.workspaces.length, 1);
  assertEquals(s.workspaces[0].id, "ws-1");
  assertEquals(s.workspaces[0].title, "Workspace 1");
  assertEquals(s.activeId, "ws-1");
});

Deno.test("addWorkspace appends a titled workspace and activates it", () => {
  const s = addWorkspace(createInitialSession());
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2"]);
  assertEquals(s.workspaces[1].title, "Workspace 2");
  assertEquals(s.activeId, "ws-2");
});

Deno.test("addWorkspace picks the smallest free ws-N id", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2", "ws-3"]);
  assertEquals(s.workspaces.map((w) => w.title), [
    "Workspace 1",
    "Workspace 2",
    "Workspace 3",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno task test` Expected: FAIL — module not found: `./session.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/session.ts`:

```ts
import {
  createInitialWorkspace,
  isWorkspaceState,
  type WorkspaceState,
} from "./workspace.ts";

// A session is an ordered set of workspaces, navigated vertically (ctrl+j j/k). Exactly
// one is "active" (the shown workspace). Workspaces are not tiled on screen: only the
// active one renders, mirroring how a workspace presents one of its views.
export interface SessionState {
  workspaces: WorkspaceState[]; // >= 1, ordered top-to-bottom in the rail
  activeId: string; // names one of the workspaces
}

// Smallest free "ws-N", mirroring workspace.ts's nextViewId so ids stay deterministic
// and test-friendly. Returns the number so the caller can title the workspace with it.
function nextWorkspaceNumber(workspaces: WorkspaceState[]): number {
  const used = new Set(workspaces.map((w) => w.id));
  let n = 1;
  while (used.has(`ws-${n}`)) n++;
  return n;
}

export function createInitialSession(): SessionState {
  const w = createInitialWorkspace();
  return { workspaces: [w], activeId: w.id };
}

// Append a fresh workspace and make it active. The title is fixed at creation from the
// id's number and never renumbers — it is a name, not a position. Closing ws-2 of three
// and adding one yields a rail reading 1, 3, 2. This is intended (see design spec).
export function addWorkspace(s: SessionState): SessionState {
  const n = nextWorkspaceNumber(s.workspaces);
  const w = createInitialWorkspace(`ws-${n}`, `Workspace ${n}`);
  return { workspaces: [...s.workspaces, w], activeId: w.id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno task test` Expected: PASS — 3 new `session_test.ts` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/session_test.ts
git commit -m "feat: add SessionState with createInitialSession and addWorkspace"
```

---

## Task 3: `session.ts` — close, focus, update, and the guard

**Files:**

- Modify: `src/lib/session.ts`
- Test: `src/lib/session_test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the import line at the top of `src/lib/session_test.ts` with:

```ts
import { assertEquals } from "@std/assert";
import {
  addWorkspace,
  closeWorkspace,
  createInitialSession,
  focusAdjacent,
  focusWorkspace,
  isSessionState,
  updateWorkspace,
} from "./session.ts";
import { addView } from "./workspace.ts";
```

Append these tests to the same file:

```ts
Deno.test("closeWorkspace removes the active one and activates the previous neighbor", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3, active
  s = closeWorkspace(s);
  assertEquals(s.workspaces.map((w) => w.id), ["ws-1", "ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

Deno.test("closeWorkspace activates the next neighbor when the first is closed", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = focusWorkspace(s, "ws-1");
  s = closeWorkspace(s);
  assertEquals(s.workspaces.map((w) => w.id), ["ws-2"]);
  assertEquals(s.activeId, "ws-2");
});

Deno.test("closeWorkspace is a no-op with a single workspace", () => {
  const s = closeWorkspace(createInitialSession());
  assertEquals(s.workspaces.length, 1);
  assertEquals(s.activeId, "ws-1");
});

Deno.test("focusAdjacent moves the active id and clamps at the ends", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3, active
  assertEquals(focusAdjacent(s, 1).activeId, "ws-3"); // already last, clamps
  s = focusAdjacent(s, -1);
  assertEquals(s.activeId, "ws-2");
  s = focusAdjacent(s, -1);
  assertEquals(s.activeId, "ws-1");
  assertEquals(focusAdjacent(s, -1).activeId, "ws-1"); // already first, clamps
});

Deno.test("focusWorkspace is a no-op for an unknown id", () => {
  const s = focusWorkspace(createInitialSession(), "ws-999");
  assertEquals(s.activeId, "ws-1");
});

Deno.test("updateWorkspace edits one workspace, leaving others untouched", () => {
  const s = addWorkspace(createInitialSession()); // ws-1, ws-2
  const next = updateWorkspace(s, "ws-2", addView);
  assertEquals(next.workspaces[0].views.length, 1);
  assertEquals(next.workspaces[1].views.length, 2);
});

Deno.test("titles do not renumber: closing ws-2 of three and adding reads 1, 3, 2", () => {
  let s = addWorkspace(createInitialSession()); // ws-2
  s = addWorkspace(s); // ws-3
  s = focusWorkspace(s, "ws-2");
  s = closeWorkspace(s); // ws-2 gone; ws-1, ws-3 remain
  s = addWorkspace(s); // smallest free is 2 again, appended at the end
  assertEquals(s.workspaces.map((w) => w.title), [
    "Workspace 1",
    "Workspace 3",
    "Workspace 2",
  ]);
});

Deno.test("isSessionState accepts a real session and rejects malformed shapes", () => {
  assertEquals(isSessionState(createInitialSession()), true);
  assertEquals(isSessionState(addWorkspace(createInitialSession())), true);
  assertEquals(
    isSessionState(JSON.parse(JSON.stringify(createInitialSession()))),
    true,
  );
  assertEquals(isSessionState(null), false);
  assertEquals(isSessionState({}), false);
  assertEquals(isSessionState({ workspaces: [], activeId: "ws-1" }), false);
  // activeId names no workspace
  const s = createInitialSession();
  assertEquals(isSessionState({ ...s, activeId: "ws-999" }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno task test` Expected: FAIL — `closeWorkspace` is not exported by
`./session.ts`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/session.ts`:

```ts
// Remove the active workspace, keeping at least one. Activates the previous neighbor if
// one exists, otherwise the next (matching closeView's neighbor rule).
export function closeWorkspace(s: SessionState): SessionState {
  if (s.workspaces.length <= 1) return s;
  const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
  if (idx === -1) return s;
  const workspaces = s.workspaces.filter((w) => w.id !== s.activeId);
  const activeId = (workspaces[idx - 1] ?? workspaces[idx]).id;
  return { workspaces, activeId };
}

// Move the active id to the neighbor in `dir` (-1 = up, +1 = down). Clamped at the ends
// (no wrap), matching view navigation.
export function focusAdjacent(s: SessionState, dir: -1 | 1): SessionState {
  const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
  if (idx === -1) return s;
  const next = Math.min(s.workspaces.length - 1, Math.max(0, idx + dir));
  return { ...s, activeId: s.workspaces[next].id };
}

export function focusWorkspace(s: SessionState, id: string): SessionState {
  if (!s.workspaces.some((w) => w.id === id)) return s;
  return { ...s, activeId: id };
}

// Replace one workspace by id via a workspace-level reducer, leaving the others alone.
export function updateWorkspace(
  s: SessionState,
  id: string,
  fn: (w: WorkspaceState) => WorkspaceState,
): SessionState {
  return {
    ...s,
    workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w)),
  };
}

// Structural guard for persisted state, mirroring isWorkspaceState one level up.
export function isSessionState(s: unknown): s is SessionState {
  if (typeof s !== "object" || s === null) return false;
  const obj = s as Record<string, unknown>;
  if (!Array.isArray(obj.workspaces) || obj.workspaces.length === 0) {
    return false;
  }
  if (!obj.workspaces.every(isWorkspaceState)) return false;
  return typeof obj.activeId === "string" &&
    (obj.workspaces as WorkspaceState[]).some((w) => w.id === obj.activeId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno task test` Expected: PASS — all `session_test.ts` and
`workspace_test.ts` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/session_test.ts
git commit -m "feat: add session close, focus, update, and validation"
```

---

## Task 4: Store — session writable, derived stores, two-level routing

**Files:**

- Modify: `src/lib/store.ts`

No test step: `store.ts` is a thin binding layer over reducers already covered
by Tasks 1–3, and it touches `localStorage` (not available under `deno test`).
The existing `store.ts` has no test file — follow that precedent. Verification
is Task 7's manual run.

- [ ] **Step 1: Rewrite the imports and state**

Replace the import block and the `KEY` / `load` / `workspace` section at the top
of `src/lib/store.ts` (lines 1–47) with:

```ts
import { derived, get, writable } from "svelte/store";
import {
  addTab as addTabFn,
  type Boundary,
  closeTab as closeTabFn,
  createInitialView,
  resizeBoundary as resize,
  resizeRowSplit as resizeRowFn,
  setActiveTab as setActiveTabFn,
  type SideId,
  toggleCollapse as collapseFn,
  toggleRows as rowsFn,
  type ViewState,
} from "./layout.ts";
import {
  addView as addViewFn,
  closeView as closeViewFn,
  focusAdjacent as focusAdjacentFn,
  focusView as focusViewFn,
  updateView,
  type WorkspaceState,
} from "./workspace.ts";
import {
  addWorkspace as addWorkspaceFn,
  closeWorkspace as closeWorkspaceFn,
  createInitialSession,
  focusAdjacent as focusAdjacentWorkspaceFn,
  focusWorkspace as focusWorkspaceFn,
  isSessionState,
  type SessionState,
  updateWorkspace,
} from "./session.ts";

// v5: the top-level shape gained a session wrapping N workspaces. Stored v4 layouts fail
// isSessionState and fall back to defaults — no migration (see design spec).
const KEY = "pique.layout.v5";

function load(): SessionState {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isSessionState(parsed)) return parsed;
    } catch {
      // corrupt storage — fall back to defaults
    }
  }
  return createInitialSession();
}

export const session = writable<SessionState>(load());

// The shown workspace: the rail's selection, and what view-level actions target.
export const activeWorkspace = derived(
  session,
  (s) => s.workspaces.find((w) => w.id === s.activeId)!,
);

// The presented view of the shown workspace: keyboard nav and the top bar act on this.
export const activeView = derived(
  activeWorkspace,
  (w) => w.views.find((v) => v.id === w.activeId)!,
);
```

- [ ] **Step 2: Update the persistence subscription**

Immediately below, replace the `workspace.subscribe(...)` block with:

```ts
// Persist on a trailing debounce so a splitter drag (which mutates the store on every
// pointermove) doesn't do synchronous JSON.stringify + setItem on each frame.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
session.subscribe((s) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () => localStorage.setItem(KEY, JSON.stringify(s)),
    150,
  );
});
```

- [ ] **Step 3: Route the view-scoped helper through two levels**

Replace the `edit` helper (the old `function edit(viewId, fn)`) with:

```ts
// Workspace-scoped edit: applies a workspace-level reducer to the shown workspace.
function editWorkspace(fn: (w: WorkspaceState) => WorkspaceState): void {
  session.update((s) => updateWorkspace(s, s.activeId, fn));
}

// View-scoped actions — components pass their own view id, so a view's controls always
// act on that view whether or not it is the active one. Views are addressed within the
// shown workspace.
function edit(viewId: string, fn: (v: ViewState) => ViewState): void {
  editWorkspace((w) => updateView(w, viewId, fn));
}
```

Every existing view-scoped wrapper below it (`resizeBoundary`, `toggleCollapse`,
`toggleRows`, `resizeRow`, `addTab`, `setActiveTab`, `closeTab`, `resetView`)
calls `edit` and needs **no change**.

- [ ] **Step 4: Retarget the view-level actions and add session-level ones**

Replace everything from the `// Workspace-level actions` comment to the end of
the file with:

```ts
// View-level actions — used by the ctrl+h chord and the top bar. They target the shown
// workspace's views.
export function addView(): void {
  editWorkspace(addViewFn);
}

export function closeView(): void {
  editWorkspace(closeViewFn);
}

export function focusAdjacent(dir: -1 | 1): void {
  editWorkspace((w) => focusAdjacentFn(w, dir));
}

export function focusView(viewId: string): void {
  editWorkspace((w) => focusViewFn(w, viewId));
}

// Returns the active VIEW id of the shown workspace — App.svelte and TopBar.svelte pass
// it to view-scoped actions, so its meaning is unchanged from before the session existed.
export function activeId(): string {
  return get(activeWorkspace).activeId;
}

// Session-level actions — used by the ctrl+j chord and the workspace rail.
export function addWorkspace(): void {
  session.update(addWorkspaceFn);
}

export function closeWorkspace(): void {
  session.update(closeWorkspaceFn);
}

// Named to disambiguate from the view-level focusAdjacent above; the asymmetry keeps
// every existing view call site untouched.
export function focusAdjacentWorkspace(dir: -1 | 1): void {
  session.update((s) => focusAdjacentWorkspaceFn(s, dir));
}

export function focusWorkspace(id: string): void {
  session.update((s) => focusWorkspaceFn(s, id));
}
```

- [ ] **Step 5: Typecheck**

Run: `deno check src/lib/store.ts` Expected: PASS (no output). Component files
still importing `workspace` will fail their own checks until Task 6 — that is
expected and is why Tasks 4–6 land together.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: make the store session-aware with v5 storage"
```

---

## Task 5: `WorkspacePane.svelte` — the left rail

**Files:**

- Create: `src/lib/WorkspacePane.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/WorkspacePane.svelte`:

```svelte
<script lang="ts">
  import { focusWorkspace, session } from "./store.ts";
</script>

<!-- Fixed-width, full-height rail listing the session's workspaces. Always visible, even
     at one workspace: a rail that appeared and disappeared would reflow every terminal in
     the app. -->
<aside class="flex w-45 shrink-0 flex-col gap-1 border-r border-base-300 bg-base-200 p-2">
  <span class="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">
    Workspaces
  </span>
  {#each $session.workspaces as w (w.id)}
    <button
      class="btn btn-ghost btn-sm justify-start font-normal"
      class:btn-active={w.id === $session.activeId}
      aria-label="Switch to {w.title}"
      aria-pressed={w.id === $session.activeId}
      onclick={() => focusWorkspace(w.id)}
    >{w.title}</button>
  {/each}
</aside>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/WorkspacePane.svelte
git commit -m "feat: add the workspace rail"
```

---

## Task 6: `Session.svelte` and the two-column shell

**Files:**

- Create: `src/lib/Session.svelte`
- Modify: `src/lib/Workspace.svelte`
- Modify: `src/lib/TopBar.svelte`
- Modify: `src/App.svelte`

- [ ] **Step 1: Create `Session.svelte`**

Create `src/lib/Session.svelte`:

```svelte
<script lang="ts">
  import { session } from "./store.ts";
  import Workspace from "./Workspace.svelte";
</script>

<!-- All workspaces stay mounted so backgrounded terminals keep running; only the selected
     one is shown. Same pattern Workspace.svelte uses for views, one level up. -->
<div class="relative min-h-0 flex-1">
  {#each $session.workspaces as w (w.id)}
    <div class="absolute inset-0" class:hidden={w.id !== $session.activeId}>
      <Workspace workspace={w} />
    </div>
  {/each}
</div>
```

- [ ] **Step 2: Make `Workspace.svelte` take a prop**

Replace all of `src/lib/Workspace.svelte`:

```svelte
<script lang="ts">
  import type { WorkspaceState } from "./workspace.ts";
  import View from "./View.svelte";

  let { workspace }: { workspace: WorkspaceState } = $props();
</script>

<!-- All views stay mounted so backgrounded terminals keep running; only the presented
     one is shown, full width. Switching (ctrl+h h/l) just changes which is visible. -->
<div class="relative h-full">
  {#each workspace.views as v (v.id)}
    <div class="absolute inset-0" class:hidden={v.id !== workspace.activeId}>
      <View view={v} />
    </div>
  {/each}
</div>
```

Note the wrapper changed from `min-h-0 flex-1` to `h-full`: it is now inside
`Session.svelte`'s `absolute inset-0` box rather than being a flex child of
`main`.

- [ ] **Step 3: Point `TopBar.svelte` at the active workspace**

In `src/lib/TopBar.svelte`, replace the import line:

```svelte
import { activeView, activeWorkspace, focusView, resetView, toggleCollapse } from "./store.ts";
```

Then replace every `$workspace` with `$activeWorkspace` in the markup — there
are five occurrences: the `{#if $workspace.views.length > 1}` guard, the
`{#each $workspace.views ...}` loop, the two `v.id === $workspace.activeId`
comparisons inside it, and three `$workspace.activeId` arguments in the
`toggleCollapse` / `resetView` handlers. After the edit,
`grep -n 'workspace' src/lib/TopBar.svelte` should show only `activeWorkspace`.

- [ ] **Step 4: Rewire the shell in `App.svelte`**

In `src/App.svelte`, replace the imports:

```svelte
import { onMount } from "svelte";
import TopBar from "./lib/TopBar.svelte";
import WorkspacePane from "./lib/WorkspacePane.svelte";
import Session from "./lib/Session.svelte";
import StatusBar from "./lib/StatusBar.svelte";
import {
  activeId,
  addView,
  addWorkspace,
  closeView,
  closeWorkspace,
  focusAdjacent,
  focusAdjacentWorkspace,
  toggleCollapse,
} from "./lib/store.ts";
```

And replace the markup at the bottom of the file:

```svelte
<div class="flex h-screen w-screen overflow-hidden bg-base-100">
  <WorkspacePane />
  <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <TopBar />
    <Session />
    <StatusBar {chordMode} />
  </main>
</div>
```

`chordMode` does not exist yet — Task 7 adds it. The file will not typecheck
until then.

- [ ] **Step 5: Commit**

```bash
git add src/lib/Session.svelte src/lib/Workspace.svelte src/lib/TopBar.svelte src/App.svelte
git commit -m "feat: render workspaces in a session with a left rail"
```

---

## Task 7: The `ctrl+j` chord and StatusBar modes

**Files:**

- Modify: `src/App.svelte`
- Modify: `src/lib/StatusBar.svelte`

- [ ] **Step 1: Replace the chord state machine**

In `src/App.svelte`, replace the chord state block and the `onMount` handler
(everything from `let chordPending` through the end of `onMount`) with:

```svelte
  // ctrl+h / ctrl+j are tmux-style prefixes: press one to enter a mode, then its keys act
  // on views (h/l) or workspaces (j/k). A mode is sticky — it stays armed so you can
  // navigate repeatedly — and exits on esc, any unrecognized key, or 2s idle.
  type ChordMode = "view" | "workspace";
  let chordMode = $state<ChordMode | null>(null);
  let chordTimer: ReturnType<typeof setTimeout> | undefined;

  function armChord(mode: ChordMode) {
    chordMode = mode;
    clearTimeout(chordTimer);
    chordTimer = setTimeout(() => (chordMode = null), 2000);
  }

  function clearChord() {
    clearTimeout(chordTimer);
    chordMode = null;
  }

  onMount(() => {
    // Modifier-only keydowns shouldn't cancel a pending chord.
    const MODS = new Set(["Control", "Meta", "Shift", "Alt"]);

    function onKeydown(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // A prefix pressed while a mode is armed switches modes rather than counting as an
      // unrecognized key, so ctrl+j then ctrl+h lands in view mode.
      if (mod && (e.code === "KeyH" || e.code === "KeyJ")) {
        e.preventDefault();
        e.stopPropagation();
        armChord(e.code === "KeyH" ? "view" : "workspace");
        return;
      }

      // Second stroke of the chord. Capture-phase + stop keeps it away from the terminal.
      if (chordMode) {
        if (MODS.has(e.key)) return;
        const mode = chordMode;
        let handled = true;
        if (mode === "view") {
          switch (e.code) {
            case "KeyN": addView(); break;
            case "KeyW": closeView(); break;
            case "KeyH": focusAdjacent(-1); break;
            case "KeyL": focusAdjacent(1); break;
            default: handled = false;
          }
        } else {
          switch (e.code) {
            case "KeyN": addWorkspace(); break;
            case "KeyW": closeWorkspace(); break;
            case "KeyK": focusAdjacentWorkspace(-1); break;
            case "KeyJ": focusAdjacentWorkspace(1); break;
            default: handled = false;
          }
        }
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          armChord(mode); // stay in the mode and restart the idle timer
        } else {
          clearChord(); // esc or any other key exits the mode
        }
        return;
      }

      if (!mod) return;

      // ctrl+b: toggle a side column of the presented view (shift = right).
      if (e.code === "KeyB") {
        e.preventDefault();
        e.stopPropagation();
        toggleCollapse(activeId(), e.shiftKey ? "right" : "left");
      }
    }
    globalThis.addEventListener("keydown", onKeydown, true);
    return () => globalThis.removeEventListener("keydown", onKeydown, true);
  });
```

The prefix check sits **above** the armed-mode branch so a prefix always
re-arms. Bare `h`/`j` (no modifier) still fall through to the armed-mode switch,
so `ctrl+j` then `j` moves down.

- [ ] **Step 2: Update `StatusBar.svelte` to take a mode**

Replace all of `src/lib/StatusBar.svelte`:

```svelte
<script lang="ts">
  type ChordMode = "view" | "workspace";
  let { chordMode = null }: { chordMode?: ChordMode | null } = $props();

  const isMac = navigator.userAgent.includes("Mac");
  const mod = isMac ? "⌘" : "⌃"; // ⌘ / ⌃

  // Each mode's sub-commands, revealed while its chord is armed.
  const keys: Record<ChordMode, { key: string; label: string }[]> = {
    view: [
      { key: "n", label: "new" },
      { key: "w", label: "close" },
      { key: "h", label: "◄" },
      { key: "l", label: "►" },
      { key: "esc", label: "exit" },
    ],
    workspace: [
      { key: "n", label: "new" },
      { key: "w", label: "close" },
      { key: "k", label: "▲" },
      { key: "j", label: "▼" },
      { key: "esc", label: "exit" },
    ],
  };
</script>

<footer class="flex h-7 shrink-0 items-center gap-4 border-t border-base-300 bg-base-200 px-3 text-xs">
  {#if chordMode}
    <span class="rounded bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-primary-content">
      {chordMode}
    </span>
    {#each keys[chordMode] as { key, label } (key)}
      <span class="flex items-center gap-1">
        <kbd class="kbd kbd-xs">{key}</kbd>
        <span class="opacity-70">{label}</span>
      </span>
    {/each}
  {:else}
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}H</kbd>
      <span class="opacity-70">view</span>
    </span>
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}J</kbd>
      <span class="opacity-70">workspace</span>
    </span>
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}B</kbd>
      <span class="opacity-70">columns</span>
    </span>
  {/if}
</footer>
```

- [ ] **Step 3: Typecheck and test**

Run: `deno task test` Expected: PASS — all `session_test.ts`,
`workspace_test.ts`, `layout_test.ts` tests green.

Run: `deno task build` Expected: build succeeds with no unresolved imports (this
is what catches a missed `$workspace` reference in a component).

- [ ] **Step 4: Manual verification**

Run: `deno task dev`

Confirm each of these:

1. The rail shows `Workspace 1`, highlighted; the StatusBar reads `⌃H view`,
   `⌃J workspace`, `⌃B columns`.
2. `ctrl+j` shows the `workspace` badge with `n w k j esc`.
3. `ctrl+j n` adds `Workspace 2` to the rail and selects it.
4. `ctrl+j k` selects Workspace 1; `ctrl+j j` returns to 2. Clamps at both ends.
5. Clicking a rail row selects that workspace.
6. `ctrl+h` shows the `view` badge; `ctrl+h n` adds a view within the current
   workspace only, and the TopBar's view numbers update.
7. **Terminal keep-alive:** run `top` in Workspace 1's terminal, `ctrl+j n` to a
   new workspace, `ctrl+j k` back — `top` is still running with scrollback
   intact and correctly sized.
8. `ctrl+j w` closes a workspace and selects a neighbor; at one workspace it
   does nothing.
9. Reload the app: the workspace list, selection, and view layouts persist.

- [ ] **Step 5: Commit**

```bash
git add src/App.svelte src/lib/StatusBar.svelte
git commit -m "feat: add the ctrl+j workspace chord"
```

---

## Self-Review Notes

- **Spec coverage:** session model → Tasks 2–3; `id`/`title` → Task 1; storage
  `v5` + no migration → Task 4; rail → Task 5; stacked rendering + keep-alive →
  Task 6; `ctrl+j` and the `ctrl+h` rename → Task 7. Non-goals (rename, reorder,
  rail resize/collapse, migration) have no tasks, as intended.
- **Known compile gap:** `store.ts` drops the `workspace` export in Task 4 while
  `TopBar`/`Workspace` still import it until Task 6, and `App.svelte` references
  `chordMode` before Task 7 defines it. Tasks 4–7 must land as one sequence;
  only Task 7 Step 3 is expected to build clean.
- **Type consistency:** `focusAdjacent` is the session-level export in
  `session.ts` but is re-exported from `store.ts` as `focusAdjacentWorkspace`
  (the view-level `focusAdjacent` keeps that name for existing call sites).
  `activeId()` keeps returning a _view_ id.
