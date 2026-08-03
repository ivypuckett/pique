# Terminal Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working interactive terminal as the first real harness module —
xterm.js in the webview, a real PTY in the Deno backend, wired by `deno desktop`
bindings.

**Architecture:** A new custom `deno desktop` backend entry (`src/desktop.ts`)
replaces Vite auto-detection. It adopts the startup window, registers
session-keyed terminal bindings (`termStart/Write/Read/Resize/Kill`), and serves
the static Vite `dist/` build. The PTY lives in a backend session registry
(`pty.ts`, unit-tested headless with a real shell). A `Terminal.svelte` module
renders xterm.js, streams keystrokes to the backend, and long-polls `termRead`
for output.

**Tech Stack:** Deno 2.9, `deno desktop` (webview), Svelte 5 (runes), Vite,
`@sigma/pty-ffi` (JSR, Rust portable-pty via FFI), `@xterm/xterm` +
`@xterm/addon-fit`, `@std/http` file-server.

**Spec:** `docs/superpowers/specs/2026-07-15-terminal-module-design.md`

---

## File structure

```
deno.json                       # add deps + FFI; point tasks at src/desktop.ts (MODIFY)
src/
  desktop.ts                    # NEW backend entry: window + bindings + serve dist/
  lib/
    layout.ts                   # center slot kind -> "terminal" (MODIFY)
    store.ts                    # bump layout storage key to v2 (MODIFY)
    terminal/
      pty.ts                    # NEW backend PTY session registry (TESTED, real shell)
      pty_test.ts               # NEW deno tests for pty.ts
      bindings.ts               # NEW frontend typed wrapper over globalThis.bindings
      bindings_test.ts          # NEW deno tests for the browser-fallback path
      Terminal.svelte           # NEW xterm.js module component
    modules/registry.ts         # register `terminal` (MODIFY)
```

### Critical constraint (do not deviate)

`deno desktop` bindings only attach if `src/desktop.ts` creates the
`Deno.BrowserWindow` as its **first statement, before any import that pulls in
`@sigma/pty-ffi`**. A static import of the PTY delays the constructor past deno
desktop's auto-navigation of the startup window, so calls fail silently with
`"No callback bound"`. Therefore `desktop.ts` **dynamically imports** the PTY
registry and the file-server after creating the window, and **never calls
`win.navigate()`** (deno desktop auto-navigates the adopted window to its served
address). This was established by a spike; see the spec's "Decisions on record".

---

## Task 1: Backend PTY session registry (`pty.ts`)

The tested foundation: spawn/track/read/resize/kill PTY sessions. Testable
headless with a real shell (FFI works under plain `deno test`, verified by the
spike).

**Files:**

- Modify: `deno.json` (add deps + `-A` on the test task)
- Create: `src/lib/terminal/pty.ts`
- Test: `src/lib/terminal/pty_test.ts`

- [ ] **Step 1: Add dependencies and FFI to `deno.json`**

In `deno.json`, add these four entries to `imports` (keep all existing entries):

```json
"@sigma/pty-ffi": "jsr:@sigma/pty-ffi@^0.42",
"@xterm/xterm": "npm:@xterm/xterm@^6",
"@xterm/addon-fit": "npm:@xterm/addon-fit@^0.11",
"@std/http": "jsr:@std/http@^1"
```

And change the `test` task so FFI-backed tests can load the native lib:

```json
"test": "deno test -A src/"
```

- [ ] **Step 2: Write the failing test** — `src/lib/terminal/pty_test.ts`

```ts
import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import {
  killSession,
  readSession,
  resizeSession,
  startSession,
  writeSession,
} from "./pty.ts";

// Non-blocking read is single-shot; drain polls it for up to `ms`.
async function drain(id: string, ms: number): Promise<string> {
  const dec = new TextDecoder(undefined, { fatal: false });
  let out = "";
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { data, done } = readSession(id);
    if (done) break;
    if (data.length) out += dec.decode(data, { stream: true });
    await new Promise((r) => setTimeout(r, 20));
  }
  return out;
}

Deno.test("startSession returns a string id", () => {
  const id = startSession({ cols: 80, rows: 24 });
  assertEquals(typeof id, "string");
  killSession(id);
});

Deno.test("write + read round-trips shell output", async () => {
  const id = startSession({ cols: 80, rows: 24 });
  await drain(id, 300); // consume the initial prompt
  writeSession(id, "echo pty-rt-$((3*4))\n");
  const out = await drain(id, 600);
  assertMatch(out, /pty-rt-12/);
  killSession(id);
});

Deno.test("resize is applied — shell reports the new size", async () => {
  const id = startSession({ cols: 80, rows: 24 });
  await drain(id, 300);
  resizeSession(id, 120, 30);
  writeSession(id, "stty size\n");
  const out = await drain(id, 600);
  assertMatch(out, /30 120/);
  killSession(id);
});

Deno.test("killSession removes the session and is idempotent", () => {
  const id = startSession({ cols: 80, rows: 24 });
  killSession(id);
  assertThrows(() => readSession(id), Error, "unknown terminal session");
  killSession(id); // second kill is a no-op, must not throw
});

Deno.test("unknown id throws a typed error for write/read/resize", () => {
  assertThrows(
    () => writeSession("nope", "x"),
    Error,
    "unknown terminal session",
  );
  assertThrows(() => readSession("nope"), Error, "unknown terminal session");
  assertThrows(
    () => resizeSession("nope", 80, 24),
    Error,
    "unknown terminal session",
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `deno test -A src/lib/terminal/pty_test.ts` Expected: FAIL —
`Module not found` / cannot resolve `./pty.ts`.

- [ ] **Step 4: Implement `src/lib/terminal/pty.ts`**

```ts
import { Pty } from "@sigma/pty-ffi";

interface Session {
  pty: Pty;
}

const sessions = new Map<string, Session>();
let counter = 0;

/** Spawn the user's shell in a PTY at the given size; returns a session id. */
export function startSession(opts: { cols: number; rows: number }): string {
  const shell = Deno.env.get("SHELL") ?? "bash";
  const pty = new Pty(shell, {
    args: ["-i"],
    env: { TERM: "xterm-256color" },
    size: { rows: opts.rows, cols: opts.cols },
  });
  const id = `t${++counter}`;
  sessions.set(id, { pty });
  return id;
}

function require(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error(`unknown terminal session: ${id}`);
  return s;
}

/** Forward keystrokes/paste to the shell. */
export function writeSession(id: string, data: string): void {
  require(id).pty.write(data);
}

/** Non-blocking single read. On process exit, closes and forgets the session. */
export function readSession(id: string): { data: Uint8Array; done: boolean } {
  const s = require(id);
  const { data, done } = s.pty.readBytes();
  if (done) {
    s.pty.close();
    sessions.delete(id);
  }
  return { data, done };
}

/** Resize the PTY (sends SIGWINCH to the foreground process group). */
export function resizeSession(id: string, cols: number, rows: number): void {
  require(id).pty.resize({ rows, cols });
}

/** Close and forget a session. Idempotent — unknown/closed ids are a no-op. */
export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.pty.close();
  sessions.delete(id);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `deno test -A src/lib/terminal/pty_test.ts` Expected: PASS — 5 tests ok.
(First run may download the native lib from GitHub releases.)

- [ ] **Step 6: Commit**

```bash
git add deno.json src/lib/terminal/pty.ts src/lib/terminal/pty_test.ts
git commit -m "feat(terminal): backend PTY session registry"
```

---

## Task 2: Backend entry (`desktop.ts`) + task wiring

Replace Vite auto-detection with a custom backend that adopts the window,
registers the terminal bindings, and serves the built frontend. Verification is
a manual launch (this is glue over the already-tested `pty.ts`).

**Files:**

- Create: `src/desktop.ts`
- Modify: `deno.json` (dev task → build frontend, compile `src/desktop.ts`, run
  it)

- [ ] **Step 1: Create `src/desktop.ts`**

```ts
// deno desktop backend entry.
//
// The window MUST be created before any import that pulls in @sigma/pty-ffi, or the
// startup window is not adopted and bindings never attach ("No callback bound").
// So this file has NO static imports — the PTY registry and file-server are loaded
// dynamically below, and we never call win.navigate() (deno desktop auto-navigates
// the adopted window to the address Deno.serve binds to).

const win = new Deno.BrowserWindow({
  title: "pique",
  width: 1200,
  height: 800,
});

const { serveDir } = await import("jsr:@std/http@^1/file-server");
const term = await import("./lib/terminal/pty.ts");

win.bind("termStart", async (arg) => {
  const { cols, rows } = arg as { cols: number; rows: number };
  return { id: term.startSession({ cols, rows }) };
});

win.bind("termWrite", async (arg) => {
  const { id, data } = arg as { id: string; data: string };
  term.writeSession(id, data);
  return true;
});

// Long-poll: resolve as soon as bytes arrive or the shell exits; otherwise return
// empty after 20s so the frontend re-issues the read (bounded, backpressured).
win.bind("termRead", async (arg) => {
  const { id } = arg as { id: string };
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { data, done } = term.readSession(id);
    if (done) return { data: new Uint8Array(0), done: true };
    if (data.length) return { data, done: false };
    await new Promise((r) => setTimeout(r, 15));
  }
  return { data: new Uint8Array(0), done: false };
});

win.bind("termResize", async (arg) => {
  const { id, cols, rows } = arg as { id: string; cols: number; rows: number };
  term.resizeSession(id, cols, rows);
  return true;
});

win.bind("termKill", async (arg) => {
  const { id } = arg as { id: string };
  term.killSession(id);
  return true;
});

// Serve the static Vite build. deno desktop auto-navigates the adopted window here.
Deno.serve((req) => serveDir(req, { fsRoot: "dist", quiet: true }));
```

- [ ] **Step 2: Point the dev task at the new entry in `deno.json`**

Replace the `dev` task value with (this keeps the existing `unset …` WebKit fix
and the `&& ./pique/pique` run; it adds `-A` so the compiled binary has
FFI/env/net/read, and `--include dist` so the built frontend is embedded in the
binary):

```json
"dev": "unset LD_LIBRARY_PATH LD_PRELOAD GTK_PATH GTK_EXE_PREFIX GTK_IM_MODULE_FILE GDK_PIXBUF_MODULE_FILE GDK_PIXBUF_MODULEDIR GIO_MODULE_DIR GSETTINGS_SCHEMA_DIR GCONV_PATH LOCPATH GTK_RC_FILES GTK2_RC_FILES && deno run -A npm:vite build && deno desktop -A --include dist --output pique src/desktop.ts && ./pique/pique",
```

- [ ] **Step 3: Type-check the backend entry**

Run: `deno check src/desktop.ts` Expected: no errors. (If a `win.bind` handler
return type is rejected, the handler must be `async` and return a
JSON-serializable value — the code above already satisfies this.)

- [ ] **Step 4: Launch and verify the real app renders via the custom backend**

Run: `deno task dev` Expected: the pique window opens showing the existing
3-column layout (served by `desktop.ts` out of the embedded `dist/`, not
auto-detect). The center pane still shows the placeholder for now. Close the
window to exit.

> If the window is blank, `serveDir` is not finding the embedded `dist/`.
> Confirm `--include dist` is present and that `vite build` produced
> `dist/index.html` before the `deno desktop` step. Do not proceed until the
> layout renders.

- [ ] **Step 5: Commit**

```bash
git add src/desktop.ts deno.json
git commit -m "feat(terminal): custom deno desktop backend with terminal bindings"
```

---

## Task 3: Frontend bindings wrapper (`bindings.ts`)

A typed accessor over the `globalThis.bindings` bridge that returns `null`
outside the desktop window (e.g. the browser `web` task), so the module can
degrade gracefully.

**Files:**

- Create: `src/lib/terminal/bindings.ts`
- Test: `src/lib/terminal/bindings_test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/terminal/bindings_test.ts`

```ts
import { assertEquals } from "@std/assert";
import { terminalBindings } from "./bindings.ts";

Deno.test("terminalBindings returns null when the bridge is absent (browser/test)", () => {
  // In deno test there is no deno desktop window, so globalThis.bindings is undefined.
  assertEquals(terminalBindings(), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/terminal/bindings_test.ts` Expected: FAIL — cannot
resolve `./bindings.ts`.

- [ ] **Step 3: Implement `src/lib/terminal/bindings.ts`**

```ts
// Typed access to the deno desktop bindings bridge. `globalThis.bindings` is a callable
// proxy injected only inside the desktop window; it is undefined in a plain browser tab.

export interface TerminalBindings {
  termStart(arg: { cols: number; rows: number }): Promise<{ id: string }>;
  termWrite(arg: { id: string; data: string }): Promise<unknown>;
  termRead(arg: { id: string }): Promise<{ data: Uint8Array; done: boolean }>;
  termResize(arg: { id: string; cols: number; rows: number }): Promise<unknown>;
  termKill(arg: { id: string }): Promise<unknown>;
}

export function terminalBindings(): TerminalBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as TerminalBindings) : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A src/lib/terminal/bindings_test.ts` Expected: PASS — 1 test
ok.

- [ ] **Step 5: Commit**

```bash
git add src/lib/terminal/bindings.ts src/lib/terminal/bindings_test.ts
git commit -m "feat(terminal): typed frontend bindings wrapper"
```

---

## Task 4: Terminal module component + registration

Render xterm.js, stream keystrokes out, long-poll output in, forward resize,
tear down on unmount. Then register it and make the center slot a terminal so it
shows on launch.

**Files:**

- Create: `src/lib/terminal/Terminal.svelte`
- Modify: `src/lib/modules/registry.ts`
- Modify: `src/lib/layout.ts:44` (center row kind + title)
- Modify: `src/lib/store.ts:14` (bump storage key so the new default is used)

- [ ] **Step 1: Create `src/lib/terminal/Terminal.svelte`**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { terminalBindings } from "./bindings.ts";

  let { title }: { title: string } = $props();
  let host: HTMLDivElement;

  onMount(() => {
    const term = new Terminal({ fontFamily: "monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const b = terminalBindings();
    if (!b) {
      term.write("Terminal unavailable — run the desktop app (bindings are not present in a browser tab).\r\n");
      return () => term.dispose();
    }

    let id: string | undefined;
    let alive = true;

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (id) b.termResize({ id, cols: term.cols, rows: term.rows });
    });

    (async () => {
      const started = await b.termStart({ cols: term.cols, rows: term.rows });
      id = started.id;
      term.onData((data) => b!.termWrite({ id: id!, data }));
      ro.observe(host);
      while (alive) {
        const { data, done } = await b.termRead({ id });
        if (done) {
          term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
          break;
        }
        if (data.length) term.write(data);
      }
    })();

    return () => {
      alive = false;
      ro.disconnect();
      if (id) b.termKill({ id });
      term.dispose();
    };
  });
</script>

<div bind:this={host} class="h-full w-full" title={title}></div>
```

- [ ] **Step 2: Register the module** — `src/lib/modules/registry.ts`

Replace the file with:

```ts
import type { Component } from "svelte";
import Placeholder from "./Placeholder.svelte";
import Terminal from "../terminal/Terminal.svelte";

export const registry: Record<string, Component<{ title: string }>> = {
  placeholder: Placeholder,
  terminal: Terminal,
};
```

- [ ] **Step 3: Make the center slot a terminal** — `src/lib/layout.ts`

At `src/lib/layout.ts:44`, change the center row from:

```ts
rows: [{ id: "center-1", title: "Center", kind: "placeholder" }],
```

to:

```ts
rows: [{ id: "center-1", title: "Terminal", kind: "terminal" }],
```

- [ ] **Step 4: Bump the layout storage key** — `src/lib/store.ts`

At `src/lib/store.ts:14`, change:

```ts
const KEY = "pique.layout.v1";
```

to:

```ts
const KEY = "pique.layout.v2";
```

(A cached `v1` layout would otherwise still show the old placeholder center.
Bumping the key discards the stale saved layout so the new terminal default
takes effect.)

- [ ] **Step 5: Verify existing unit tests still pass**

Run: `deno test -A src/` Expected: PASS — the Task 1/3 terminal tests plus all
existing `layout_test.ts` tests. (`layout_test.ts` asserts the center has one
row, not its `kind`, so it is unaffected.)

- [ ] **Step 6: Build the frontend to fetch xterm into node_modules and check it
      bundles**

Run: `deno run -A npm:vite build` Expected: build succeeds; `dist/` is produced
with the xterm assets bundled (no unresolved-import errors for `@xterm/xterm` or
its CSS).

- [ ] **Step 7: Commit**

```bash
git add src/lib/terminal/Terminal.svelte src/lib/modules/registry.ts src/lib/layout.ts src/lib/store.ts
git commit -m "feat(terminal): xterm.js module wired to backend, shown in center slot"
```

---

## Task 5: End-to-end verification against success criteria

No new code — drive the real app and confirm each spec success criterion. Fix
regressions in the owning task if any fail.

- [ ] **Step 1: Launch**

Run: `deno task dev`

- [ ] **Step 2: Live shell (criteria 1–2)**

Confirm the center pane shows a shell prompt. Type `ls -la` and `echo $TERM` →
output renders; `echo $TERM` prints `xterm-256color`; colors from `ls` are
visible.

- [ ] **Step 3: Full-screen app + reflow (criteria 3–4)**

Run `vim` (or `top`) in the terminal → it draws its full-screen UI correctly.
Drag the column splitter to resize the pane → the app reflows to the new size.
Run `stty size` → rows/cols match the resized pane. Quit the app (`:q!` / `q`).

- [ ] **Step 4: No orphaned shells on close (criterion 5)**

In a separate OS terminal, count the PTY-spawned shells before and after:

Run (before closing pique): `pgrep -a -f "$SHELL" | wc -l` Then close the pique
window. Run (after): `pgrep -a -f "$SHELL" | wc -l` Expected: the count drops by
one — the terminal's shell process is gone. (`Terminal.svelte` teardown calls
`termKill` on unmount, and the backend exits on window `close`, closing any
surviving PTY.) A non-decreasing count means a leaked shell — fix teardown in
Task 4.

- [ ] **Step 5: Clean shell exit (criterion 6)**

Launch again, type `exit` in the terminal → the pane shows a dim
`[session ended]` and does not error or respawn.

- [ ] **Step 6: Final commit (docs/status)**

Update the spec status line
`docs/superpowers/specs/2026-07-15-terminal-module-design.md` from
`Approved, pending implementation plan` to `Implemented`.

```bash
git add docs/superpowers/specs/2026-07-15-terminal-module-design.md
git commit -m "docs(terminal): mark spec implemented"
```

---

## Notes on deferred / out-of-scope items

- **Multiple concurrent terminals:** the binding API is already session-keyed; a
  second terminal is `termStart` again with another id. No code here blocks it.
- **ModuleFrame padding:** the terminal renders inset by the frame's `p-3` body
  padding. Acceptable for this milestone; a padding-less body variant is
  deferred polish and would touch shared `ModuleFrame.svelte`.
- **HMR:** out of scope — the dev loop is build-then-run. The `web` task still
  gives fast browser iteration for non-terminal UI (terminal shows its
  "unavailable" notice there).
