# Layout Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single, correct View — three resizable/collapsible columns
(20/60/20) holding mocked modules — as the foundation of the Pique coding
harness.

**Architecture:** A Svelte SPA served by `deno desktop`'s Vite auto-detection.
Pure layout math (widths, collapse redistribution, grid template) lives in
`layout.ts` and is unit-tested with `deno test`. A `writable` store wraps that
logic, persists to `localStorage`, and drives dumb Svelte components
(`Workspace → View → Column → ModuleFrame → Placeholder`).

**Tech Stack:** Deno 2.9, Svelte 5 (runes), Vite, Tailwind CSS v4 + DaisyUI v5,
`deno desktop` (webview backend).

**Spec:** `docs/superpowers/specs/2026-07-14-layout-shell-design.md`

---

## File structure

```
deno.json            # tasks, npm import map, nodeModulesDir, desktop config
vite.config.ts       # svelte + tailwind plugins
svelte.config.js     # vitePreprocess
index.html           # Vite entry, #app mount point
src/
  main.ts            # mounts App
  app.css            # tailwind + daisyui entry, dark theme
  App.svelte         # full-screen shell → Workspace
  lib/
    layout.ts        # types + pure functions (TESTED)
    layout_test.ts   # deno tests for layout.ts
    store.ts         # writable store + localStorage + actions
    Workspace.svelte # tiles views (one for now)
    View.svelte      # grid of 3 columns + splitters, drag geometry
    Column.svelte    # rows or collapsed rail; collapse/row controls
    Splitter.svelte  # pointer-drag divider
    ModuleFrame.svelte # DaisyUI pane chrome (header + body)
    modules/
      Placeholder.svelte # mocked module body
```

The old `Deno.serve` `main.ts` is deleted (replaced by `src/main.ts` + the Vite
SPA).

---

## Task 1: Scaffold toolchain + walking skeleton

Prove Svelte + Tailwind + DaisyUI render inside `deno desktop` before building
any logic.

**Files:**

- Delete: `main.ts`
- Modify: `deno.json`
- Create: `vite.config.ts`, `svelte.config.js`, `index.html`, `src/main.ts`,
  `src/app.css`, `src/App.svelte`

- [ ] **Step 1: Replace `deno.json`**

```json
{
  "name": "pique",
  "version": "0.1.0",
  "nodeModulesDir": "auto",
  "tasks": {
    "dev": "unset GIO_MODULE_DIR && deno desktop --hmr .",
    "build": "unset GIO_MODULE_DIR && deno run -A npm:vite build && deno desktop .",
    "test": "deno test src/"
  },
  "imports": {
    "svelte": "npm:svelte@^5",
    "svelte/": "npm:/svelte@^5/",
    "vite": "npm:vite@^6",
    "@sveltejs/vite-plugin-svelte": "npm:@sveltejs/vite-plugin-svelte@^5",
    "@tailwindcss/vite": "npm:@tailwindcss/vite@^4",
    "tailwindcss": "npm:tailwindcss@^4",
    "daisyui": "npm:daisyui@^5",
    "@std/assert": "jsr:@std/assert@^1"
  },
  "compilerOptions": {
    "types": ["svelte"]
  },
  "desktop": {
    "app": { "name": "pique" },
    "backend": "webview"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
});
```

- [ ] **Step 3: Create `svelte.config.js`**

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default { preprocess: vitePreprocess() };
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pique</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/app.css`**

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: dark --default, light;
}

html,
body,
#app {
  height: 100%;
  margin: 0;
}
```

- [ ] **Step 6: Create `src/main.ts`**

```ts
import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

export default mount(App, { target: document.getElementById("app")! });
```

- [ ] **Step 7: Create `src/App.svelte` (temporary skeleton)**

```svelte
<script lang="ts">
</script>

<main class="flex h-screen w-screen items-center justify-center bg-base-300">
  <button class="btn btn-primary">Pique is alive</button>
</main>
```

- [ ] **Step 8: Delete the old server entry and add `.gitignore`**

```bash
git rm main.ts
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
```

(Keep `deno.lock` tracked.)

- [ ] **Step 9: Install deps (allow build scripts) and launch**

```bash
deno install --allow-scripts
deno task dev
```

Expected: a desktop window opens showing a centered DaisyUI primary button
reading "Pique is alive" on a dark background. If `--hmr` fails to start the
Vite dev server for the SPA, fall back to running `deno run -A npm:vite` in one
terminal and `deno desktop http://localhost:5173` — but try the task first.
Close the window to stop.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Scaffold Svelte + Vite + DaisyUI shell under deno desktop"
```

---

## Task 2: Layout types + initial view (TDD)

**Files:**

- Create: `src/lib/layout.ts`, `src/lib/layout_test.ts`

- [ ] **Step 1: Write the failing test — `src/lib/layout_test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { createInitialView, visibleIds } from "./layout.ts";

Deno.test("createInitialView starts at 20/60/20, none collapsed", () => {
  const v = createInitialView();
  assertEquals(v.left.widthPct, 20);
  assertEquals(v.center.widthPct, 60);
  assertEquals(v.right.widthPct, 20);
  assertEquals([v.left.collapsed, v.center.collapsed, v.right.collapsed], [
    false,
    false,
    false,
  ]);
});

Deno.test("visible widths sum to 100", () => {
  const v = createInitialView();
  const sum = visibleIds(v).reduce((s, id) => s + v[id].widthPct, 0);
  assertEquals(sum, 100);
});

Deno.test("center has one row, left has two", () => {
  const v = createInitialView();
  assertEquals(v.center.rows.length, 1);
  assertEquals(v.left.rows.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test src/lib/layout_test.ts` Expected: FAIL — module `./layout.ts`
not found.

- [ ] **Step 3: Implement `src/lib/layout.ts`**

```ts
export type ColumnId = "left" | "center" | "right";
export type SideId = "left" | "right";

export interface ModuleRef {
  id: string;
  title: string;
  kind: string; // key into the module registry; "placeholder" for now
}

export interface ColumnState {
  widthPct: number; // share of the visible row; visible columns sum to 100
  collapsed: boolean; // center is never collapsed
  savedWidthPct: number; // width restored on expand
  rows: ModuleRef[]; // 1 for center; 1 or 2 for sides
}

export interface ViewState {
  left: ColumnState;
  center: ColumnState;
  right: ColumnState;
}

export const MIN_WIDTH_PCT = 10;

export function createInitialView(): ViewState {
  return {
    left: {
      widthPct: 20,
      collapsed: false,
      savedWidthPct: 20,
      rows: [
        { id: "left-1", title: "Left A", kind: "placeholder" },
        { id: "left-2", title: "Left B", kind: "placeholder" },
      ],
    },
    center: {
      widthPct: 60,
      collapsed: false,
      savedWidthPct: 60,
      rows: [{ id: "center-1", title: "Center", kind: "placeholder" }],
    },
    right: {
      widthPct: 20,
      collapsed: false,
      savedWidthPct: 20,
      rows: [{ id: "right-1", title: "Right", kind: "placeholder" }],
    },
  };
}

const ALL_IDS: ColumnId[] = ["left", "center", "right"];

export function visibleIds(v: ViewState): ColumnId[] {
  return ALL_IDS.filter((id) => !v[id].collapsed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test src/lib/layout_test.ts` Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout.ts src/lib/layout_test.ts
git commit -m "Add layout types and initial view"
```

---

## Task 3: Resize + grid template pure functions (TDD)

**Files:**

- Modify: `src/lib/layout.ts`, `src/lib/layout_test.ts`

- [ ] **Step 1: Add failing tests to `src/lib/layout_test.ts`**

```ts
import {
  createInitialView,
  fixedPx,
  gridTemplateColumns,
  MIN_WIDTH_PCT,
  resizeBoundary,
  visibleIds,
} from "./layout.ts";

Deno.test("resizeBoundary moves width between two columns, keeps their sum", () => {
  const v = resizeBoundary(createInitialView(), "left-center", 30);
  assertEquals(v.left.widthPct, 30);
  assertEquals(v.center.widthPct, 50); // 80 combined - 30
  assertEquals(v.right.widthPct, 20);
});

Deno.test("resizeBoundary clamps to MIN_WIDTH_PCT", () => {
  const v = resizeBoundary(createInitialView(), "left-center", 2);
  assertEquals(v.left.widthPct, MIN_WIDTH_PCT);
  assertEquals(v.center.widthPct, 80 - MIN_WIDTH_PCT);
});

Deno.test("gridTemplateColumns lists fr tracks and splitters when all visible", () => {
  assertEquals(
    gridTemplateColumns(createInitialView()),
    "20fr 6px 60fr 6px 20fr",
  );
});

Deno.test("fixedPx counts two splitters when all visible", () => {
  assertEquals(fixedPx(createInitialView()), 12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test src/lib/layout_test.ts` Expected: FAIL — `resizeBoundary` /
`gridTemplateColumns` / `fixedPx` not exported.

- [ ] **Step 3: Append to `src/lib/layout.ts`**

```ts
export type Boundary = "left-center" | "center-right";

export const SPLITTER_PX = 6;
export const RAIL_PX = 40;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function resizeBoundary(
  v: ViewState,
  b: Boundary,
  newFirstPct: number,
): ViewState {
  const [a, c]: [ColumnId, ColumnId] = b === "left-center"
    ? ["left", "center"]
    : ["center", "right"];
  const combined = v[a].widthPct + v[c].widthPct;
  const first = clamp(newFirstPct, MIN_WIDTH_PCT, combined - MIN_WIDTH_PCT);
  return {
    ...v,
    [a]: { ...v[a], widthPct: first },
    [c]: { ...v[c], widthPct: combined - first },
  };
}

export function fixedPx(v: ViewState): number {
  const splitters = (v.left.collapsed ? 0 : 1) + (v.right.collapsed ? 0 : 1);
  const rails = (v.left.collapsed ? 1 : 0) + (v.right.collapsed ? 1 : 0);
  return splitters * SPLITTER_PX + rails * RAIL_PX;
}

export function gridTemplateColumns(v: ViewState): string {
  const parts: string[] = [];
  parts.push(v.left.collapsed ? `${RAIL_PX}px` : `${v.left.widthPct}fr`);
  if (!v.left.collapsed) parts.push(`${SPLITTER_PX}px`);
  parts.push(`${v.center.widthPct}fr`);
  if (!v.right.collapsed) parts.push(`${SPLITTER_PX}px`);
  parts.push(v.right.collapsed ? `${RAIL_PX}px` : `${v.right.widthPct}fr`);
  return parts.join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test src/lib/layout_test.ts` Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout.ts src/lib/layout_test.ts
git commit -m "Add resize and grid-template layout functions"
```

---

## Task 4: Collapse/expand + row toggle (TDD)

**Files:**

- Modify: `src/lib/layout.ts`, `src/lib/layout_test.ts`

- [ ] **Step 1: Add failing tests to `src/lib/layout_test.ts`**

```ts
import { toggleCollapse, toggleRows } from "./layout.ts";

Deno.test("collapsing left redistributes its width, remembers it", () => {
  const v = toggleCollapse(createInitialView(), "left");
  assertEquals(v.left.collapsed, true);
  assertEquals(v.left.widthPct, 0);
  assertEquals(v.left.savedWidthPct, 20);
  assertEquals(v.center.widthPct, 75); // 60 + 20*(60/80)
  assertEquals(v.right.widthPct, 25); // 20 + 20*(20/80)
  assertEquals(visibleIds(v), ["center", "right"]);
});

Deno.test("expanding restores the original layout", () => {
  const collapsed = toggleCollapse(createInitialView(), "left");
  const v = toggleCollapse(collapsed, "left");
  assertEquals(v.left.collapsed, false);
  assertEquals(v.left.widthPct, 20);
  assertEquals(v.center.widthPct, 60);
  assertEquals(v.right.widthPct, 20);
});

Deno.test("toggleRows adds then removes a second row on a side column", () => {
  const two = toggleRows(createInitialView(), "right");
  assertEquals(two.right.rows.length, 2);
  const one = toggleRows(two, "right");
  assertEquals(one.right.rows.length, 1);
  assertEquals(one.right.rows[0].id, "right-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test src/lib/layout_test.ts` Expected: FAIL — `toggleCollapse` /
`toggleRows` not exported.

- [ ] **Step 3: Append to `src/lib/layout.ts`**

```ts
function cap(id: SideId): string {
  return id === "left" ? "Left" : "Right";
}

function collapse(v: ViewState, id: SideId): ViewState {
  const others = visibleIds(v).filter((x) => x !== id);
  const freed = v[id].widthPct;
  const otherSum = others.reduce((s, x) => s + v[x].widthPct, 0);
  const next: ViewState = {
    ...v,
    [id]: { ...v[id], collapsed: true, savedWidthPct: freed, widthPct: 0 },
  };
  for (const x of others) {
    next[x] = {
      ...v[x],
      widthPct: v[x].widthPct + freed * (v[x].widthPct / otherSum),
    };
  }
  return next;
}

function expand(v: ViewState, id: SideId): ViewState {
  const target = v[id].savedWidthPct;
  const others = visibleIds(v); // id is still collapsed, so excluded
  const otherSum = others.reduce((s, x) => s + v[x].widthPct, 0);
  const factor = (otherSum - target) / otherSum;
  const next: ViewState = {
    ...v,
    [id]: { ...v[id], collapsed: false, widthPct: target },
  };
  for (const x of others) {
    next[x] = { ...v[x], widthPct: v[x].widthPct * factor };
  }
  return next;
}

export function toggleCollapse(v: ViewState, id: SideId): ViewState {
  return v[id].collapsed ? expand(v, id) : collapse(v, id);
}

export function toggleRows(v: ViewState, id: SideId): ViewState {
  const col = v[id];
  const rows: ModuleRef[] = col.rows.length === 1
    ? [...col.rows, {
      id: `${id}-2`,
      title: `${cap(id)} B`,
      kind: "placeholder",
    }]
    : [col.rows[0]];
  return { ...v, [id]: { ...col, rows } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test src/lib/layout_test.ts` Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout.ts src/lib/layout_test.ts
git commit -m "Add collapse/expand and row-toggle layout functions"
```

---

## Task 5: Reactive store with persistence

Thin reactive wrapper over the pure functions; not unit-tested (browser
`localStorage` + trivial wiring), verified live in Task 9.

**Files:**

- Create: `src/lib/store.ts`

- [ ] **Step 1: Create `src/lib/store.ts`**

```ts
import { writable } from "svelte/store";
import {
  type Boundary,
  createInitialView,
  resizeBoundary as resize,
  type SideId,
  toggleCollapse as collapseFn,
  toggleRows as rowsFn,
  type ViewState,
} from "./layout.ts";

const KEY = "pique.layout.v1";

function load(): ViewState {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as ViewState;
    } catch {
      // corrupt storage — fall back to defaults
    }
  }
  return createInitialView();
}

export const view = writable<ViewState>(load());

view.subscribe((v) => localStorage.setItem(KEY, JSON.stringify(v)));

export function resizeBoundary(b: Boundary, newFirstPct: number): void {
  view.update((v) => resize(v, b, newFirstPct));
}

export function toggleCollapse(id: SideId): void {
  view.update((v) => collapseFn(v, id));
}

export function toggleRows(id: SideId): void {
  view.update((v) => rowsFn(v, id));
}
```

- [ ] **Step 2: Type-check**

Run: `deno check src/lib/store.ts` Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "Add reactive layout store with localStorage persistence"
```

---

## Task 6: Module chrome + placeholder body + registry

**Files:**

- Create: `src/lib/ModuleFrame.svelte`, `src/lib/modules/Placeholder.svelte`,
  `src/lib/modules/registry.ts`

- [ ] **Step 1: Create `src/lib/ModuleFrame.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, actions, children }: {
    title: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="m-1 flex h-full min-h-0 flex-col overflow-hidden rounded-box border border-base-300 bg-base-100">
  <header class="flex h-9 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
    <span class="truncate text-sm font-medium">{title}</span>
    <span class="flex items-center gap-1">{@render actions?.()}</span>
  </header>
  <div class="min-h-0 flex-1 overflow-auto p-3">{@render children()}</div>
</section>
```

- [ ] **Step 2: Create `src/lib/modules/Placeholder.svelte`**

```svelte
<script lang="ts">
  let { title }: { title: string } = $props();
</script>

<div class="text-sm opacity-70">
  <p>Placeholder module: <span class="font-mono">{title}</span></p>
  <p class="mt-2">Harness content will render here.</p>
</div>
```

- [ ] **Step 3: Create `src/lib/modules/registry.ts`**

This is the interface that must age well: modules are addressed by a
serializable `kind` string, and the registry maps that to a Svelte component.
Registering a real module later (agent chat, diff, terminal) is a one-line
addition here — no layout code changes. Every registered component takes a
single `title: string` prop.

```ts
import type { Component } from "svelte";
import Placeholder from "./Placeholder.svelte";

export const registry: Record<string, Component<{ title: string }>> = {
  placeholder: Placeholder,
};
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/ModuleFrame.svelte src/lib/modules/Placeholder.svelte src/lib/modules/registry.ts
git commit -m "Add module frame chrome, placeholder module, and registry"
```

---

## Task 7: Column (rows, rail, controls)

**Files:**

- Create: `src/lib/Column.svelte`

- [ ] **Step 1: Create `src/lib/Column.svelte`**

```svelte
<script lang="ts">
  import { view, toggleCollapse, toggleRows } from "./store.ts";
  import type { ColumnId, SideId } from "./layout.ts";
  import ModuleFrame from "./ModuleFrame.svelte";
  import { registry } from "./modules/registry.ts";

  let { id, el = $bindable() }: { id: ColumnId; el?: HTMLElement } = $props();

  const col = $derived($view[id]);
  const isSide = id === "left" || id === "right";
  const sideId = id as SideId;
</script>

{#if col.collapsed}
  <div
    class="flex flex-col items-center gap-1 bg-base-200 pt-2"
    bind:this={el}
  >
    <button
      class="btn btn-ghost btn-xs"
      aria-label="Expand {id} column"
      onclick={() => toggleCollapse(sideId)}
    >»</button>
    <span class="mt-1 [writing-mode:vertical-rl] text-xs opacity-60">{col.rows[0].title}</span>
  </div>
{:else}
  <div
    class="grid h-full min-w-0"
    style:grid-template-rows={col.rows.length === 2 ? "1fr 1fr" : "1fr"}
    bind:this={el}
  >
    {#each col.rows as row, i (row.id)}
      {@const Module = registry[row.kind]}
      <div class="min-h-0">
        <ModuleFrame title={row.title}>
          {#snippet actions()}
            {#if isSide && i === 0}
              <button
                class="btn btn-ghost btn-xs"
                aria-label={col.rows.length === 2 ? "Remove second row" : "Add second row"}
                onclick={() => toggleRows(sideId)}
              >{col.rows.length === 2 ? "−" : "+"}</button>
              <button
                class="btn btn-ghost btn-xs"
                aria-label="Collapse {id} column"
                onclick={() => toggleCollapse(sideId)}
              >«</button>
            {/if}
          {/snippet}
          <Module title={row.title} />
        </ModuleFrame>
      </div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 2: Commit**

(Svelte components are compile-checked headlessly via `vite build` in Task 9 —
`deno check` cannot parse `.svelte`.)

```bash
git add src/lib/Column.svelte
git commit -m "Add Column with rows, collapsed rail, and controls"
```

---

## Task 8: Splitter + View (grid assembly + drag)

**Files:**

- Create: `src/lib/Splitter.svelte`, `src/lib/View.svelte`

- [ ] **Step 1: Create `src/lib/Splitter.svelte`**

```svelte
<script lang="ts">
  let { onDrag }: { onDrag: (clientX: number) => void } = $props();
  let dragging = $state(false);

  function down(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (dragging) onDrag(e.clientX);
  }
  function up(e: PointerEvent) {
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

<div
  class="cursor-col-resize bg-base-300 transition-colors hover:bg-primary"
  class:bg-primary={dragging}
  role="separator"
  aria-orientation="vertical"
  tabindex="-1"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
></div>
```

- [ ] **Step 2: Create `src/lib/View.svelte`**

```svelte
<script lang="ts">
  import { view, resizeBoundary } from "./store.ts";
  import { type Boundary, fixedPx, gridTemplateColumns } from "./layout.ts";
  import Column from "./Column.svelte";
  import Splitter from "./Splitter.svelte";

  let gridEl: HTMLDivElement;
  let leftEl: HTMLElement | undefined = $state();
  let centerEl: HTMLElement | undefined = $state();

  function onDrag(b: Boundary, clientX: number) {
    const firstEl = b === "left-center" ? leftEl : centerEl;
    if (!firstEl || !gridEl) return;
    const flexPx = gridEl.clientWidth - fixedPx($view);
    if (flexPx <= 0) return;
    const newFirstPx = clientX - firstEl.getBoundingClientRect().left;
    resizeBoundary(b, (newFirstPx / flexPx) * 100);
  }
</script>

<div
  class="grid h-full w-full"
  style:grid-template-columns={gridTemplateColumns($view)}
  bind:this={gridEl}
>
  <Column id="left" bind:el={leftEl} />
  {#if !$view.left.collapsed}
    <Splitter onDrag={(x) => onDrag("left-center", x)} />
  {/if}
  <Column id="center" bind:el={centerEl} />
  {#if !$view.right.collapsed}
    <Splitter onDrag={(x) => onDrag("center-right", x)} />
  {/if}
  <Column id="right" />
</div>
```

- [ ] **Step 3: Commit**

(Compile-checked headlessly via `vite build` in Task 9.)

```bash
git add src/lib/Splitter.svelte src/lib/View.svelte
git commit -m "Add Splitter and View grid with drag-to-resize"
```

---

## Task 9: Assemble app + verify all success criteria

**Files:**

- Create: `src/lib/Workspace.svelte`
- Modify: `src/App.svelte`

- [ ] **Step 1: Create `src/lib/Workspace.svelte`**

```svelte
<script lang="ts">
  import View from "./View.svelte";
</script>

<div class="min-h-0 flex-1">
  <View />
</div>
```

- [ ] **Step 2: Replace `src/App.svelte`**

```svelte
<script lang="ts">
  import Workspace from "./lib/Workspace.svelte";
</script>

<main class="flex h-screen w-screen flex-col overflow-hidden bg-base-300">
  <Workspace />
</main>
```

- [ ] **Step 3: Run full test suite**

Run: `deno task test` Expected: PASS (10 tests).

- [ ] **Step 4: Headless compile check (catches Svelte/type errors without a
      window)**

Run: `deno run -A npm:vite build` Expected: build succeeds, emits `dist/`. Any
Svelte compile or import error fails here. Fix before launching.

- [ ] **Step 5: Launch and verify every success criterion**

Run: `deno task dev`

Confirm each, matching the spec's success criteria:

1. One view, three columns at ~20/60/20; left column shows two stacked modules,
   center and right one each; all with DaisyUI card chrome on a dark theme.
2. Drag the divider between columns → widths change smoothly; a column cannot
   shrink below ~10%.
3. Click « on a side column → it collapses to a thin rail with a » expand
   button; the other columns grow to fill. Click » → the previous width is
   restored.
4. Click + / − on a side column's header → it toggles between one and two
   stacked rows.
5. Resize/collapse, then close and relaunch (`deno task dev`) → the layout is
   exactly as left.
6. `deno task test` passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/Workspace.svelte src/App.svelte
git commit -m "Assemble Workspace and App shell"
```

---

## Deferred (explicitly out of scope)

- Multiple workspaces (vertical tiling) and screens.
- Saved / predefined Layouts.
- Real module functionality (agent chat, diff, terminal, …).
- Resizable row dividers (row split is fixed 50/50).
- Final placement of the row-count control (provisional +/− button in the header
  for now).
