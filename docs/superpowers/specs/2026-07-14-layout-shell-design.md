# Pique Layout Shell — Design

**Date:** 2026-07-14
**Status:** Approved, pending implementation plan

## Purpose

Pique will become a coding harness. This first milestone builds the **layout shell**
that harness modules will live in, with modules fully mocked. The deliverable is a
single, correct **View** — the atomic unit everything else composes from — with a
clean module interface so real modules and higher-level tiling slot in later without
a rewrite.

## Concept model

- **Workspace** — a set of views which horizontally tile and fill the screen.
  Additional workspaces tile vertically.
- **Screen** — one width/height of the physical screen minus non-workspace chrome.
- **View** — one or more modules filling one screen. Three resizable, collapsible
  columns starting at 20% / 60% / 20%. The center column has one row; each side
  column has one to two rows depending on preference.
- **Layout** — a pre-defined view (future).
- **Module** — a single pane that lets the user understand and/or act against a
  workspace.

## Scope for this milestone

**In:** One view, columns done right — 3 columns at 20/60/20, resizable, collapsible,
side columns split into 1–2 rows, module slots filled by static placeholders.

**Out (deferred):** Multiple workspaces, screens, saved/predefined Layouts, real module
functionality, resizable row dividers.

Component boundaries are designed so deferred items are additive (a loop / a new
registered component), not a rewrite.

## Architecture: concept → components

Each concept becomes a component, nested as the model describes:

- **App** — stacks Workspaces vertically. *Milestone: renders one workspace.*
- **Workspace** — tiles Views horizontally. *Milestone: renders one view.*
- **View** — the 3 columns (20/60/20), resizable + collapsible.
- **Column** — holds 1–2 Row slots (center always 1; sides 1 or 2 by preference).
- **ModuleFrame** — a pane: DaisyUI header (title + action slot) wrapping a body slot.
- **Module** — for this milestone a `Placeholder` component rendering its name + dummy
  content.

Rationale: Workspace and View already render lists, so multi-workspace/multi-view
tiling later is a loop over existing components.

## Module interface (the boundary that must age well)

A module is `{ id, title, component }`. `ModuleFrame` renders the chrome; the module
component fills the body slot. Swapping a placeholder for a real agent-chat, diff, or
terminal module later means registering a different component under the same interface,
with no layout changes. This is the primary interface to get right now, since the whole
harness hangs off it.

## Layout mechanics & state

Single Svelte store describing the view layout:

```
view: {
  left:   { widthPct: 20, collapsed: false, rows: [modA, modB?] },
  center: { widthPct: 60, rows: [modC] },
  right:  { widthPct: 20, collapsed: false, rows: [modD] },
}
```

- **Widths** — percentages that always sum to 100 across *visible* columns; rendered
  via CSS Grid `grid-template-columns`.
- **Resize** — a `Splitter` drag-divider between columns updates widths live, clamped
  to a minimum (~10%).
- **Collapse** — a side column drops to a thin rail with an expand affordance; its
  share redistributes to the remaining visible columns, and its prior width is restored
  on expand.
- **Rows** — side columns render 1 or 2 rows per a preference toggle; the 2-row split is
  a fixed 50/50 for this milestone (resizable row dividers deferred).
- **Persistence** — the store mirrors to `localStorage`, so layout survives reload.

The width redistribution + clamp logic lives in **pure functions** in `layout.ts`,
separate from components, which makes it unit-testable.

## Files & tooling

```
deno.json          # updated tasks + desktop config (keeps the GIO_MODULE_DIR fix)
vite.config.ts     # Svelte + Tailwind/DaisyUI plugins
index.html
src/
  main.ts          # mounts App
  app.css          # Tailwind + DaisyUI entry
  App.svelte
  lib/
    layout.ts      # store + types + pure width logic
    Workspace.svelte  View.svelte  Column.svelte
    ModuleFrame.svelte  Splitter.svelte
    modules/Placeholder.svelte
```

- The current `Deno.serve` hello-world `main.ts` is **replaced** by the Vite SPA.
- Stack: **Svelte + Vite**, **Tailwind + DaisyUI** for chrome, dark theme default.
- `deno desktop` auto-detects the Vite project (via `vite.config.*`), serves the
  `vite build` output from `dist/` with an index.html fallback, and under `--hmr` runs
  the Vite dev server with Svelte hot-reload. Plain-Svelte SPA (no SSR).
- Tasks:
  - `deno task dev` → `deno desktop --hmr`
  - `deno task build` → `vite build && deno desktop`
  - Both preserve the `unset GIO_MODULE_DIR` startup fix.

## Success criteria

1. App launches → one view, 3 columns at 20/60/20, placeholder modules with DaisyUI
   chrome.
2. Drag a gutter → columns resize, respect min width, widths sum to 100.
3. Collapse a side column → rail + others expand; expand restores prior width.
4. Side column shows 1 or 2 rows per a preference toggle.
5. Layout persists across reload.
6. Unit tests pass for the `layout.ts` width math (redistribute-on-collapse, clamp).

## Verification

- **Unit**: pure functions in `layout.ts` (redistribution, clamping) tested directly.
- **Manual/visual**: run the app and exercise resize, collapse, row-count toggle, and
  reload persistence against the success criteria.

## Decisions on record

- localStorage persistence included in this milestone.
- 2-row split fixed at 50/50; resizable row dividers deferred.
- DaisyUI dark theme default.
- **Collapse/expand uses "prior width" semantics.** Expanding a column restores the
  width it had just before it collapsed. A single collapse+expand round-trips exactly.
  Interleaving collapses of both side columns does not return to the pristine 20/60/20
  (each column restores its own pre-collapse width, which the earlier collapse had
  already shifted). Accepted as intended for this milestone; pristine round-tripping
  would require a stable-weight model (normalize visible weights to 100 at render).
