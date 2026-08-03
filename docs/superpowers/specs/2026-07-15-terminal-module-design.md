# Pique Terminal Module — Design

**Date:** 2026-07-15 **Status:** Implemented

## Purpose

Add the first **real** module to the harness: a working terminal. This proves
the module interface from the [layout shell](2026-07-14-layout-shell-design.md)
carries a non-trivial, stateful, backend-backed module, and it introduces the
piece the shell deliberately deferred — a **custom `deno desktop` backend** with
bindings, since a terminal cannot be served by frontend code alone.

## Why this needs a backend (the core constraint)

Pique is `deno desktop` with a **webview** backend: the Svelte UI runs inside
WebKit, a Deno runtime runs alongside it in the same process. The webview is a
browser context — it cannot spawn a shell, open a PTY, or touch processes. Only
the Deno side can. So a terminal is inherently **two parts** wired by a byte
stream:

- **Frontend (webview):** [xterm.js](https://github.com/xtermjs/xterm.js)
  renders the grid, ANSI, cursor, and captures keystrokes.
- **Backend (Deno):** a real **PTY** (`@sigma/pty-ffi`) spawns the shell.
- **Transport:** `deno desktop` bindings (`win.bind`) carry bytes between them.

A spike (2026-07-15) proved this path end-to-end **inside the packaged binary**
— PTY spawn (`/dev/pts/*`), byte read/write, resize, and a full
`webview → binding → PTY →
webview` roundtrip. The design below is written
against what the spike verified, and the sharp edges it found are recorded under
**Decisions on record**.

## Scope for this milestone

**In:** One terminal, spawned as a module in an existing `ModuleFrame` slot.
Real interactive shell (user's `$SHELL`, fallback `bash`). Keystrokes in, output
rendered, resize forwarded, teardown on unmount. The backend binding API is
**session-keyed** (`termStart` returns an id) so concurrent terminals are
additive later.

**Out (deferred):** Multiple concurrent terminals, terminal tabs, split
terminals, scrollback search, copy/paste affordances beyond xterm defaults,
shell integration / OSC handling, saved sessions.

Component boundaries keep the deferred items additive: multi-session is "call
`termStart` again and track another id", not a rewrite.

## Concept model fit

A terminal is just a **Module** under the existing interface
`{ id, title, component }`. It registers a `Terminal.svelte` under a new
`terminal` key in [registry.ts](../../../src/lib/modules/registry.ts), rendered
inside the existing `ModuleFrame` chrome exactly like `Placeholder`. No layout,
`View`, `Column`, or store changes. The only new frontend surface is the module
component itself.

## Architecture: the backend entry (the real change)

Today `deno desktop` **auto-detects** the Vite project and serves it; there is
no custom backend, so there is nowhere to register bindings. This milestone
replaces auto-detect with an explicit backend entry, `src/desktop.ts`, passed to
`deno desktop src/desktop.ts`. Its job:

1. Adopt the startup window and register the terminal bindings.
2. Make the Svelte frontend load in that window (prod: serve `dist/`; dev: the
   Vite dev server — see **Dev / HMR** below).

The spike found the binding wiring is **order-sensitive** and fails silently
(`"No callback bound"`) if done wrong. The required sequence:

```ts
// src/desktop.ts (shape, not final)
const win = new Deno.BrowserWindow({ title: "pique" }); // FIRST statement — adopts startup window
registerTerminalBindings(win); // bind BEFORE serving
Deno.serve(handler); // serve dist/ (auto-navigated to DENO_SERVE_ADDRESS)
// do NOT call win.navigate() — deno desktop navigates the adopted window itself
```

Rules the spike established (see [[deno-desktop-bindings-window-adoption]] in
project memory):

- `new Deno.BrowserWindow()` must be the **first statement**, before any
  top-level `import` that does async work. A top-level `import { Pty }` delays
  the constructor past deno desktop's auto-navigation, so it opens a _second_
  window instead of adopting the startup one, and bindings never reach the page.
  → **PTY is loaded via dynamic `import()` inside the handler, not a top-level
  import.**
- Register all `win.bind` **before** `Deno.serve` answers.
- **Never** call `win.navigate()`; deno desktop auto-navigates the adopted
  window to `DENO_SERVE_ADDRESS`.
- Handlers must be `async`; args arrive as `BrowserWindowValue` (possibly
  `null`) and are coerced.
- Inline `<script>` is CSP-blocked in the webview; the Vite build emits external
  bundles, so the real app is unaffected (only mattered for the spike's inline
  test).

### Dev loop (HMR deferred)

The current `dev` task is already **build-then-run** — `vite build` →
`deno desktop
--output pique .` → run the binary — with no `--hmr`. The custom
backend fits this directly: it serves the static `vite build` output (`dist/`)
through `Deno.serve`, which the window is auto-navigated to. This is exactly the
shape the spike proved (bindings + manual `Deno.serve`), so there is **no open
backend risk** for the desktop loop.

HMR (`deno desktop --hmr` + a custom backend) is **out of scope** for this
milestone. Fast frontend-only iteration still works via the existing `web` task
(Vite dev server in a browser), with the caveat that `bindings` only exist
inside the `deno desktop` window — a browser tab has no PTY, so the terminal
renders but cannot connect there. Reconciling bindings with `--hmr` can be
picked up later if the HMR loop returns; it does not block this milestone.

## Binding API surface

Session-keyed from day one; one session used this milestone.

| Binding      | Args                 | Returns                    | Notes                                                                                  |
| ------------ | -------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `termStart`  | `{ cols, rows }`     | `{ id }`                   | Spawns `$SHELL` (fallback `bash`) in a PTY at the given size.                          |
| `termWrite`  | `{ id, data }`       | `void`                     | Keystrokes/paste → PTY stdin (string).                                                 |
| `termRead`   | `{ id }`             | `{ data: number[], done }` | **Long-poll**: resolves when bytes are available or the process exits (see transport). |
| `termResize` | `{ id, cols, rows }` | `void`                     | Forwarded from xterm `FitAddon`.                                                       |
| `termKill`   | `{ id }`             | `void`                     | Closes the PTY; idempotent. Called on unmount.                                         |

Bytes cross the binding boundary as a **plain number array** — a `Uint8Array`
return throws `"invalid type: byte array"` (the docs' claim that Uint8Array is
supported is wrong in practice). The backend sends `Array.from(bytes)`; the
frontend rebuilds `new Uint8Array(data)` and hands it to xterm, which does the
UTF-8/ANSI decoding.

## Output transport: long-poll binding

The PTY read is **non-blocking polling** — `readBytes()` returns immediately,
empty if nothing is pending. Two ways to get bytes to the webview were
considered:

- **`win.executeJs` push** — the spike showed `executeJs` runs sync JS but
  **cannot await a Promise** (returns `"Unsupported result type"`), and every
  chunk would be a stringified JS call. Rejected for the output stream.
- **Long-poll binding (chosen)** — the frontend loops
  `const { data, done } = await bindings.termRead({ id })`; the backend handler
  polls the PTY on a short interval and resolves as soon as bytes arrive (or the
  shell exits). One typed channel, raw `Uint8Array`, no `executeJs`
  string-building, and it naturally applies backpressure (the next read isn't
  issued until the last is rendered).

Frontend read loop (shape):

```ts
let alive = true;
(async () => {
  while (alive) {
    const { data, done } = await bindings.termRead({ id });
    if (done) break;
    if (data.length) term.write(data);
  }
})();
```

## PTY lifecycle & resize

- **Start:** on module mount, `FitAddon.fit()` gives initial `cols/rows`; call
  `termStart({ cols, rows })`, keep the returned `id`, start the read loop.
- **Resize:** a `ResizeObserver` on the pane (panes resize via the layout
  shell's splitters) → `FitAddon.fit()` → `termResize({ id, cols, rows })`.
  Skipping this makes full-screen apps (vim, top) render wrong.
- **Teardown (must not leak):** on unmount, set `alive = false` and call
  `termKill({ id })`. The layout shell can open/close panes, so an un-killed PTY
  is a leaked shell. The backend also kills any surviving session on window
  `close`.
- **Shell exit:** `termRead` resolving `done: true` ends the loop; the module
  shows a dim "session ended" state (no auto-respawn this milestone).

## Files & tooling

```
deno.json            # new backend entry + FFI permission; keep the GIO_MODULE_DIR fix
src/
  desktop.ts         # NEW backend entry: adopts window, registers bindings, serves frontend
  lib/
    terminal/
      bindings.ts    # NEW typed wrapper around globalThis.bindings (frontend side)
      pty.ts         # NEW backend: PTY session registry (start/write/read/resize/kill)
      Terminal.svelte# NEW xterm.js module component (mount/read-loop/resize/teardown)
    modules/registry.ts  # register `terminal` alongside `placeholder`
```

- New deps: `@xterm/xterm`, `@xterm/addon-fit` (npm, into the Vite build);
  `jsr:@sigma/pty-ffi` (backend, dynamic-imported).
- **Permissions:** the backend now needs `--allow-ffi` (PTY native lib) and
  effectively spawns shells. Dev tasks already use `-A`; the shipped binary
  gains this capability. Called out explicitly because it is a real escalation
  from the pure-frontend shell.
- The PTY session registry and any size/id bookkeeping live in **plain
  functions** in `pty.ts`, separate from the window/binding glue, so they are
  unit-testable without a webview (matching the `layout.ts` pattern).
- Tasks: `deno task dev` and `deno task build` point at `src/desktop.ts` instead
  of `.`, preserving the `unset GIO_MODULE_DIR …` startup fix.

## Success criteria

1. App launches → a `terminal` module renders a live shell prompt in a
   `ModuleFrame`.
2. Typing runs commands; stdout/stderr render with correct colors and cursor
   (ANSI).
3. An interactive full-screen app (`vim` or `top`) draws correctly and reflows.
4. Resizing the pane resizes the shell (`stty size` / `$COLUMNS` reflect the new
   size).
5. Closing the pane kills the PTY — no orphaned shell process remains.
6. Exiting the shell (`exit`) ends the read loop cleanly and shows "session
   ended".
7. Unit tests pass for the `pty.ts` session registry (start returns id; kill is
   idempotent; unknown id is a no-op/typed error).

## Verification

- **Unit:** `pty.ts` session-registry functions tested directly under
  `deno test`.
- **Backend integration (headless):** a `deno test` that drives a real PTY
  session through the registry (start → write `echo` → read bytes → assert
  output → kill), mirroring the spike's headless PTY check — no webview needed.
- **Manual/visual:** launch the app; exercise typing, colors, `vim`, pane
  resize, pane close (check `ps` for orphans), and `exit`, against the success
  criteria.

## Decisions on record

- **Scope:** one terminal this milestone; binding API is session-keyed so
  multi-session is additive. (User decision, 2026-07-15.)
- **Shell:** `Deno.env.get("SHELL") ?? "bash"`, interactive. (User decision.)
- **Output transport is a long-poll `termRead` binding**, not `executeJs` push —
  because `executeJs` cannot await Promises and long-poll gives natural
  backpressure.
- **Raw bytes end-to-end:** `Uint8Array` over the binding; xterm decodes. Avoids
  UTF-8-split and NUL issues that the string API has.
- **Backend wiring is order-sensitive and fails silently** (found during
  end-to-end verification, not by tests): register **all** `win.bind` handlers
  **before the first top-level `await`** — deno desktop auto-navigates the
  window as soon as the loop yields, so a bind after `await import(...)` never
  attaches (`"No callback bound"`) and the frontend degrades quietly. Pattern:
  create window → bind synchronously (handlers close over a `let term` filled in
  later) → `await import(...)` deps → `Deno.serve`. No manual navigate. Encoded
  in project memory so it isn't re-derived.
- **HMR deferred, not a risk:** the current dev loop is build-then-run (no
  `--hmr`), which is exactly what the spike proved. The backend serves the
  static `dist/` build. Reconciling bindings with `deno desktop --hmr` is out of
  scope and can be revisited if the HMR loop returns.
