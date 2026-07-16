# Center Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the center column hold multiple switchable tabs, with a tab strip, a `+` module picker, per-tab close, and inactive tabs kept alive (hidden) so a backgrounded terminal keeps running.

**Architecture:** The center's existing `rows: ModuleRef[]` becomes an ordered tab list; a new `activeTabId` field on `ColumnState` names the visible tab. Pure reducers (`addTab`/`setActiveTab`/`closeTab`) in `layout.ts` mutate the immutable view, exposed through thin `store.ts` wrappers. A new `TabStrip.svelte` renders the strip; `Column.svelte` gains a center branch that mounts every tab's module at once and hides inactive ones with `display:none` (never unmounting, so terminals survive). Side columns keep their unchanged row-split path.

**Tech Stack:** Deno, Svelte 5 (runes), Tailwind + daisyui, xterm.js. Tests: `deno test` with `@std/assert`.

**Design spec:** `docs/superpowers/specs/2026-07-16-center-tabs-design.md`

---

## File Structure

- `src/lib/layout.ts` (modify) — add `activeTabId` to `ColumnState`; add `moduleLabel`, `nextCenterId` helpers and the `addTab` / `setActiveTab` / `closeTab` reducers; extend `createInitialView` and `isColumnState`. Export `moduleLabel`.
- `src/lib/layout_test.ts` (modify) — unit tests for the new field, reducers, and validation.
- `src/lib/store.ts` (modify) — bump storage key to `v3`; add `addTab` / `closeTab` / `setActiveTab` wrappers.
- `src/lib/TabStrip.svelte` (create) — the center tab strip: tab buttons, close controls, `+` module-picker dropdown.
- `src/lib/Column.svelte` (modify) — add the center branch that renders `<TabStrip>` plus all tab modules (active visible, inactive hidden).

---

## Task 1: Data model — `activeTabId` field, defaults, validation, storage key

**Files:**
- Modify: `src/lib/layout.ts`
- Modify: `src/lib/store.ts`
- Test: `src/lib/layout_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/layout_test.ts` (the imports `createInitialView`, `isViewState` already exist at the top of the file):

```ts
Deno.test("createInitialView sets activeTabId to the first row of each column", () => {
  const v = createInitialView();
  assertEquals(v.left.activeTabId, "left-1");
  assertEquals(v.center.activeTabId, "center-1");
  assertEquals(v.right.activeTabId, "right-1");
});

Deno.test("isViewState rejects a column missing activeTabId", () => {
  const bad = createInitialView() as unknown as Record<string, Record<string, unknown>>;
  delete bad.center.activeTabId;
  assertEquals(isViewState(bad), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test -A src/lib/layout_test.ts`
Expected: the two new tests FAIL (`activeTabId` is `undefined`; `isViewState` still returns `true`).

- [ ] **Step 3: Add the field, defaults, and validation**

In `src/lib/layout.ts`, add `activeTabId` to the interface:

```ts
export interface ColumnState {
  widthPct: number; // share of the visible row; visible columns sum to 100
  collapsed: boolean; // center is never collapsed
  savedWidthPct: number; // width restored on expand
  rows: ModuleRef[]; // center: the tab list (N); sides: 1 or 2 rows
  rowSplitPct: number; // height % of the first row when a side column shows 2 rows
  activeTabId: string; // visible center tab; sides carry it for shape uniformity
}
```

In `createInitialView`, add `activeTabId` to each column (matching its first row id):

```ts
    left: {
      widthPct: 20,
      collapsed: false,
      savedWidthPct: 20,
      rowSplitPct: 50,
      activeTabId: "left-1",
      rows: [
        { id: "left-1", title: "Left A", kind: "placeholder" },
        { id: "left-2", title: "Left B", kind: "placeholder" },
      ],
    },
    center: {
      widthPct: 60,
      collapsed: false,
      savedWidthPct: 60,
      rowSplitPct: 50,
      activeTabId: "center-1",
      rows: [{ id: "center-1", title: "Terminal", kind: "terminal" }],
    },
    right: {
      widthPct: 20,
      collapsed: false,
      savedWidthPct: 20,
      rowSplitPct: 50,
      activeTabId: "right-1",
      rows: [{ id: "right-1", title: "Right", kind: "placeholder" }],
    },
```

In `isColumnState`, add the `activeTabId` check to the returned expression:

```ts
  return typeof col.widthPct === "number" && typeof col.collapsed === "boolean" &&
    typeof col.savedWidthPct === "number" && typeof col.rowSplitPct === "number" &&
    typeof col.activeTabId === "string" &&
    Array.isArray(col.rows) && col.rows.length > 0 && col.rows.every(isModuleRef);
```

- [ ] **Step 4: Bump the storage key**

In `src/lib/store.ts`, change the key so old persisted layouts (which lack `activeTabId`) are ignored and defaults load:

```ts
const KEY = "pique.layout.v3";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test -A src/lib/layout_test.ts`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/layout.ts src/lib/store.ts src/lib/layout_test.ts
git commit -m "feat: add activeTabId to ColumnState for center tabs"
```

---

## Task 2: `addTab` reducer + store wrapper

**Files:**
- Modify: `src/lib/layout.ts`
- Modify: `src/lib/store.ts`
- Test: `src/lib/layout_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/layout_test.ts`, and add `addTab` to the existing `./layout.ts` import list at the top of the file:

```ts
Deno.test("addTab appends a tab to center and activates it", () => {
  const v = addTab(createInitialView(), "placeholder");
  assertEquals(v.center.rows.length, 2);
  assertEquals(v.center.rows[1], { id: "center-2", title: "Placeholder", kind: "placeholder" });
  assertEquals(v.center.activeTabId, "center-2");
});

Deno.test("addTab picks the smallest free center-N id", () => {
  let v = addTab(createInitialView(), "terminal"); // center-2
  v = addTab(v, "terminal"); // center-3
  assertEquals(v.center.rows.map((r) => r.id), ["center-1", "center-2", "center-3"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test -A src/lib/layout_test.ts`
Expected: FAIL with "addTab is not defined" (or import error).

- [ ] **Step 3: Implement `addTab` and helpers**

In `src/lib/layout.ts`, add (place near the other reducers):

```ts
// Display label for a module kind, used for new-tab titles and the picker menu.
export function moduleLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function nextCenterId(rows: ModuleRef[]): string {
  const used = new Set(rows.map((r) => r.id));
  let n = 1;
  while (used.has(`center-${n}`)) n++;
  return `center-${n}`;
}

export function addTab(v: ViewState, kind: string): ViewState {
  const id = nextCenterId(v.center.rows);
  const tab: ModuleRef = { id, title: moduleLabel(kind), kind };
  return {
    ...v,
    center: { ...v.center, rows: [...v.center.rows, tab], activeTabId: id },
  };
}
```

- [ ] **Step 4: Add the store wrapper**

In `src/lib/store.ts`, add `addTab as addTabFn` to the `./layout.ts` import block, then add the wrapper:

```ts
export function addTab(kind: string): void {
  view.update((v) => addTabFn(v, kind));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test -A src/lib/layout_test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layout.ts src/lib/store.ts src/lib/layout_test.ts
git commit -m "feat: addTab reducer and store action"
```

---

## Task 3: `setActiveTab` reducer + store wrapper

**Files:**
- Modify: `src/lib/layout.ts`
- Modify: `src/lib/store.ts`
- Test: `src/lib/layout_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/layout_test.ts`, and add `setActiveTab` to the `./layout.ts` import list:

```ts
Deno.test("setActiveTab switches the active center tab", () => {
  const two = addTab(createInitialView(), "placeholder"); // center-2 active
  const v = setActiveTab(two, "center-1");
  assertEquals(v.center.activeTabId, "center-1");
});

Deno.test("setActiveTab is a no-op for an unknown tab id", () => {
  const v = createInitialView();
  assertEquals(setActiveTab(v, "center-999").center.activeTabId, "center-1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test -A src/lib/layout_test.ts`
Expected: FAIL with "setActiveTab is not defined".

- [ ] **Step 3: Implement `setActiveTab`**

In `src/lib/layout.ts`:

```ts
export function setActiveTab(v: ViewState, tabId: string): ViewState {
  if (!v.center.rows.some((r) => r.id === tabId)) return v;
  return { ...v, center: { ...v.center, activeTabId: tabId } };
}
```

- [ ] **Step 4: Add the store wrapper**

In `src/lib/store.ts`, add `setActiveTab as setActiveTabFn` to the import block, then:

```ts
export function setActiveTab(tabId: string): void {
  view.update((v) => setActiveTabFn(v, tabId));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test -A src/lib/layout_test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layout.ts src/lib/store.ts src/lib/layout_test.ts
git commit -m "feat: setActiveTab reducer and store action"
```

---

## Task 4: `closeTab` reducer + store wrapper

**Files:**
- Modify: `src/lib/layout.ts`
- Modify: `src/lib/store.ts`
- Test: `src/lib/layout_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/layout_test.ts`, and add `closeTab` to the `./layout.ts` import list:

```ts
Deno.test("closeTab removes a tab", () => {
  const two = addTab(createInitialView(), "placeholder"); // center-1, center-2
  const v = closeTab(two, "center-2");
  assertEquals(v.center.rows.map((r) => r.id), ["center-1"]);
});

Deno.test("closeTab is a no-op when only one tab remains", () => {
  const v = createInitialView();
  assertEquals(closeTab(v, "center-1").center.rows.length, 1);
  assertEquals(closeTab(v, "center-1").center.activeTabId, "center-1");
});

Deno.test("closeTab activates the previous tab when the active one is closed", () => {
  let v = addTab(createInitialView(), "placeholder"); // center-2
  v = addTab(v, "placeholder"); // center-3, active
  v = closeTab(v, "center-3");
  assertEquals(v.center.activeTabId, "center-2"); // previous neighbor
});

Deno.test("closeTab activates the next tab when the first (active) tab is closed", () => {
  let v = addTab(createInitialView(), "placeholder"); // center-2
  v = setActiveTab(v, "center-1"); // center-1 active
  v = closeTab(v, "center-1");
  assertEquals(v.center.rows.map((r) => r.id), ["center-2"]);
  assertEquals(v.center.activeTabId, "center-2"); // no previous, so next
});

Deno.test("closeTab leaves the active tab unchanged when closing a different tab", () => {
  let v = addTab(createInitialView(), "placeholder"); // center-2, active
  v = closeTab(v, "center-1");
  assertEquals(v.center.activeTabId, "center-2");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test -A src/lib/layout_test.ts`
Expected: FAIL with "closeTab is not defined".

- [ ] **Step 3: Implement `closeTab`**

In `src/lib/layout.ts`:

```ts
export function closeTab(v: ViewState, tabId: string): ViewState {
  const rows = v.center.rows;
  if (rows.length <= 1) return v; // center always keeps at least one tab
  const idx = rows.findIndex((r) => r.id === tabId);
  if (idx === -1) return v;
  const nextRows = rows.filter((r) => r.id !== tabId);
  let activeTabId = v.center.activeTabId;
  if (activeTabId === tabId) {
    // Prefer the previous tab; fall back to the next (now at idx after removal).
    activeTabId = (nextRows[idx - 1] ?? nextRows[idx]).id;
  }
  return { ...v, center: { ...v.center, rows: nextRows, activeTabId } };
}
```

- [ ] **Step 4: Add the store wrapper**

In `src/lib/store.ts`, add `closeTab as closeTabFn` to the import block, then:

```ts
export function closeTab(tabId: string): void {
  view.update((v) => closeTabFn(v, tabId));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test -A src/lib/layout_test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/layout.ts src/lib/store.ts src/lib/layout_test.ts
git commit -m "feat: closeTab reducer and store action"
```

---

## Task 5: `TabStrip.svelte` component

**Files:**
- Create: `src/lib/TabStrip.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/TabStrip.svelte`:

```svelte
<script lang="ts">
  import { addTab, closeTab, setActiveTab } from "./store.ts";
  import { type ColumnState, moduleLabel } from "./layout.ts";
  import { registry } from "./modules/registry.ts";

  let { col }: { col: ColumnState } = $props();
  const kinds = Object.keys(registry);
</script>

<div class="flex shrink-0 items-center gap-1 border-b border-base-300 bg-base-200 px-1 py-1">
  {#each col.rows as tab (tab.id)}
    <div
      class="flex items-center gap-1 rounded-field px-2 py-0.5 text-sm"
      class:bg-base-100={tab.id === col.activeTabId}
      class:font-medium={tab.id === col.activeTabId}
    >
      <button class="truncate" onclick={() => setActiveTab(tab.id)}>{tab.title}</button>
      {#if col.rows.length > 1}
        <button
          class="btn btn-ghost btn-xs px-1"
          aria-label="Close {tab.title} tab"
          onclick={() => closeTab(tab.id)}
        >×</button>
      {/if}
    </div>
  {/each}
  <div class="dropdown dropdown-end">
    <button tabindex="0" class="btn btn-ghost btn-xs" aria-label="Add tab">+</button>
    <ul tabindex="0" class="dropdown-content menu z-10 mt-1 w-40 rounded-box bg-base-200 p-1 shadow">
      {#each kinds as kind (kind)}
        <li><button onclick={() => addTab(kind)}>{moduleLabel(kind)}</button></li>
      {/each}
    </ul>
  </div>
</div>
```

- [ ] **Step 2: Verify it type-checks / builds**

Run: `deno task build`
Expected: build succeeds with no Svelte/TS errors. (`TabStrip` isn't rendered yet — this only confirms the component compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/TabStrip.svelte
git commit -m "feat: TabStrip component for center tabs"
```

---

## Task 6: Wire the center branch into `Column.svelte`

**Files:**
- Modify: `src/lib/Column.svelte`

- [ ] **Step 1: Import TabStrip**

In the `<script>` of `src/lib/Column.svelte`, add:

```ts
  import TabStrip from "./TabStrip.svelte";
```

- [ ] **Step 2: Add the center branch**

In `src/lib/Column.svelte`, the render currently reads `{#if col.collapsed} …rail… {:else} …rows grid… {/if}`. Insert a center branch between them by changing the `{:else}` that opens the rows grid into `{:else if id === "center"}` … `{:else}`. Concretely, replace the opening of the non-collapsed block:

Find:

```svelte
{:else}
  <div
    class="grid h-full min-w-0"
    style:grid-template-rows={col.rows.length === 2
```

Replace with:

```svelte
{:else if id === "center"}
  <div class="flex h-full min-w-0 flex-col" bind:this={el}>
    <TabStrip {col} />
    <div class="relative min-h-0 flex-1">
      {#each col.rows as tab (tab.id)}
        {@const Module = registry[tab.kind]}
        <div class="absolute inset-0" class:hidden={tab.id !== col.activeTabId}>
          <ModuleFrame title={tab.title}>
            {#if Module}
              <Module title={tab.title} />
            {:else}
              <div class="text-sm opacity-60">
                Unknown module: <span class="font-mono">{tab.kind}</span>
              </div>
            {/if}
          </ModuleFrame>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div
    class="grid h-full min-w-0"
    style:grid-template-rows={col.rows.length === 2
```

The rest of the existing rows-grid block (the sides path) stays exactly as-is.

- [ ] **Step 3: Build to verify it compiles**

Run: `deno task build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/Column.svelte
git commit -m "feat: render center column as tabs"
```

---

## Task 7: Manual verification — terminal keep-alive & tab behavior

**Files:** none (runtime verification)

- [ ] **Step 1: Launch the desktop app**

Run: `deno task dev`
Expected: the window opens with a single center tab "Terminal" showing a live shell.

- [ ] **Step 2: Verify add / picker**

Click `+` in the center tab strip → choose "Terminal". A second tab "Terminal" appears and becomes active with its own shell. Click `+` → "Placeholder" → a placeholder tab appears and activates.

- [ ] **Step 3: Verify keep-alive (the core risk)**

In the first terminal tab, run `top`. Switch to another tab, wait a few seconds, then switch back. Expected: `top` is **still running**, scrollback is intact, and the terminal is sized to the pane (no clipped/garbled layout).

- [ ] **Step 4: Verify close & minimum-one**

Close a tab with its `×`; the active tab falls back to a neighbor. Close down to a single tab; the `×` disappears (cannot close the last tab).

- [ ] **Step 5: Verify persistence & reset**

Reload/reopen the app: the center tab set and active tab persist (storage key `pique.layout.v3`). The side columns still collapse (Ctrl/Cmd+B) and row-split exactly as before.

- [ ] **Step 6: Final full-suite check**

Run: `deno task test`
Expected: all tests pass.
```
