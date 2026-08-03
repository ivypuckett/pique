# Pi Extensions: Install & Manage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let pique users install, list, and remove pi extensions (as pi
packages) from inside the app, sharing the same extension set as their `pi` CLI
install. Global extensions already **load** automatically today; this plan adds
the _management_ surface and the agent-restart that makes newly installed
extensions take effect.

**Status (2026-07-20): IMPLEMENTED on `main` working tree (not committed).** New
`src/lib/chat/extensions.ts` (+ `extensions_test.ts`), `piAgentDir()` in
`settings/file.ts`, `agentDir: piAgentDir()` in `agent.ts`,
`ExtBindings`/`extBindings()` in chat `bindings.ts`, `ext*` binds in
`desktop.ts`, and an Extensions section in `SettingsModal.svelte` with the
confirm gate. 106 tests pass, `deno check` + `vite build` clean,
`listExtensions()` smoke-verified under `deno run`. Not yet driven in the real
desktop GUI (needs a display) or against a real install (network) — same gap as
the chat-module spike.

**Key finding (verified 2026-07-20, drives the whole design):** pique's
[agent.ts](../../../src/lib/chat/agent.ts) calls `createAgentSession(...)` with
**no `resourceLoader`**. The SDK (`dist/core/sdk.js:71-73`) then builds a
`DefaultResourceLoader({ cwd, agentDir, settingsManager })` and reloads it, with
default `agentDir = ~/.pi/agent`. So pique **already discovers and loads**:

- `~/.pi/agent/extensions/*.ts` (+ `*/index.ts`) — global
- packages/extensions declared in `~/.pi/agent/settings.json` — global

It does **not** load project-local `.pi/extensions/` — pique's path calls
`reload()` with no `resolveProjectTrust`, so `projectTrusted` stays false
(`resource-loader.js:209-227,752`). That safe default is kept; project-local
trust is out of scope here.

Therefore "install a pi extension" == "add a pi package to
`~/.pi/agent/settings.json` and fetch it", then restart the agent so
`createAgentSession()` re-runs the loader.

**Architecture:** Same in-process design as the chat module — pi runs in the
Deno desktop process. Add a small backend module `src/lib/chat/extensions.ts`
that wraps pi's exported `DefaultPackageManager`, expose `ext*` bindings over
`win.bind` (same hand-synced contract as `chat*`), and surface a minimal manager
UI in the existing Settings modal. Installing/removing then calls the existing
`stopAgent`/`startAgent` for open chat modules so the change takes effect.

**Tech Stack:** Deno 2.9.2, `@earendil-works/pi-coding-agent@^0.80`, Svelte 5
runes, Tailwind 4 + daisyUI 5, `deno test`.

**Prerequisite context:**

- Chat module is on `main`: `src/lib/chat/{agent.ts,bindings.ts,Chat.svelte}`,
  `chat*` binds in `src/desktop.ts`, `chat` entry in
  `src/lib/modules/registry.ts`.
- Settings modal exists:
  `src/lib/settings/{SettingsModal.svelte,bindings.ts,store.ts,file.ts,dialog.ts}`.
  Config persists to `~/.pique/*.json` via `config*` binds. **Extensions do NOT
  go here** — see Decision 1.
- Binding contracts are hand-synced across two module graphs (frontend
  `bindings.ts` ↔ backend `desktop.ts`); nothing cross-checks them at compile
  time. Bindings MUST be registered before the first top-level `await` in
  `desktop.ts` (window auto-navigates once the loop yields).
- Bindings must return JSON (no `Uint8Array`).

**Authoritative pi types (from installed `dist/core/package-manager.d.ts`,
`dist/config.d.ts`, `dist/core/settings-manager.d.ts`):**

```typescript
// Construct once, agentDir = getAgentDir() = ~/.pi/agent
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
const settingsManager = SettingsManager.create(cwd, getAgentDir());
const pm = new DefaultPackageManager({
  cwd,
  agentDir: getAgentDir(),
  settingsManager,
});

interface PackageManager {
  installAndPersist(
    source: string,
    options?: { local?: boolean },
  ): Promise<void>; // fetch + write settings.json
  removeAndPersist(
    source: string,
    options?: { local?: boolean },
  ): Promise<boolean>;
  update(source?: string): Promise<void>;
  listConfiguredPackages(): ConfiguredPackage[];
  setProgressCallback(cb: ((e: ProgressEvent) => void) | undefined): void;
}
interface ConfiguredPackage {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
}
interface ProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  action: "install" | "remove" | "update" | "clone" | "pull";
  source: string;
  message?: string;
}
// Source strings: "npm:@scope/pkg@1.2.3", "npm:pkg", "git:github.com/user/repo@v1", absolute/relative local paths.
```

---

## Decisions (resolve before coding — these are the real "pre-work")

**Decision 1 — SEPARATE extension folder (`~/.pique/agent`), shared credentials.
[IMPLEMENTED]** Extensions install into pique's own agentDir `~/.pique/agent`
(via `DefaultPackageManager`), NOT the user's `pi` CLI at `~/.pi/agent` — so
installing in pique never touches their pi setup. This is safe because
`ModelRuntime.create()` (agent.ts, no args) always reads `auth.json` +
`models.json` from `~/.pi/agent` regardless of agentDir, and pique passes its
own `modelRuntime`; `SessionManager.inMemory()` means the session dir is unused
too. The only change to _load_ separately is passing `agentDir: piAgentDir()` to
`createAgentSession`. `piAgentDir()` lives in `settings/file.ts`.

**Decision 2 — Global scope only (`local: false`).** Install/remove with the
default user scope. Project-local packages require project trust; keep that out
of scope. Do not pass `{ local: true }`.

**Decision 3 — Restart, don't hot-reload.** Extensions bind at
`createAgentSession()` time. After install/remove, tear down and recreate each
open chat agent. pique does not expose pi's `/reload`; reuse
`stopAgent`+`startAgent`. Simplest UX: the manager UI tells the user "restart
chat to apply", OR we auto-restart open Chat modules. Pick one in Task 4
(recommended: explicit "apply/restart" affordance — avoids interrupting an
in-flight prompt).

**Decision 4 — Security gate (mandatory).** Extensions run arbitrary code with
full permissions in the desktop process (where API keys live). The install
action MUST show the exact source string and a trust warning, and require
explicit confirmation, before calling `installAndPersist`. Never install from a
string that didn't come from direct user input in the UI.

**Decision 5 — Native-dep caveat (document, don't solve).** The packaged desktop
runtime lacks Node-API; extensions with native addons may fail hard (see the
chat-module memory's napi note). Surface `install`/load errors in the UI rather
than swallowing them. A future RPC-subprocess move is the real fix; not in scope
here.

---

## File Structure

- **New** `src/lib/chat/extensions.ts` — Deno-side wrapper over
  `DefaultPackageManager`: `listExtensions()`, `installExtension(source)`,
  `removeExtension(source)`. Lazily constructs one `DefaultPackageManager`.
  Header comment states Decision 1 (writes to `~/.pi/agent`, shared with pi).
- **New** `src/lib/chat/extensions_test.ts` — unit tests for the pure parts
  (source-string validation, result shaping). The install/remove calls hit
  npm/git/network, so those are NOT unit-tested here (mirrors how agent.ts
  network paths are spike-verified, not unit-tested).
- Modify `src/lib/chat/bindings.ts` — add an `ExtBindings` interface (`extList`,
  `extInstall`, `extRemove`) + a `extBindings()` accessor, mirroring
  `chatBindings()`.
- Modify `src/desktop.ts` — register `extList`/`extInstall`/`extRemove` handlers
  (before the top-level await), and
  `const extensions = await import("./lib/chat/extensions.ts")` alongside the
  other deps.
- Modify `src/lib/settings/SettingsModal.svelte` — add an "Extensions" section:
  list installed packages, a source input + Install button (with confirm), a
  Remove button per row, and an errors/progress area.

No changes to `agent.ts` are required for loading (it already works). `agent.ts`
is only touched if Task 4 chooses auto-restart.

---

## Task 1: Backend wrapper module (TDD where pure)

**Files:** New `src/lib/chat/extensions.ts`, new
`src/lib/chat/extensions_test.ts`.

- [ ] **Step 1 — validation tests (failing):** In `extensions_test.ts`, test a
      pure `isValidSource(s)` helper: accepts `npm:pkg`, `npm:@scope/pkg@1.2.3`,
      `git:github.com/u/r@v1`, absolute/relative paths; rejects empty/whitespace
      and obviously bogus input. Test a pure `toExtInfo(pkg)` that maps
      `ConfiguredPackage` → the frontend shape `{ source, scope, path }`.
- [ ] **Step 2 — implement:** `extensions.ts` exports:
  - `isValidSource(source: string): boolean` (pure)
  - `toExtInfo(pkg): ExtInfo` (pure);
    `export type ExtInfo = { source: string; scope: string; path?: string }`
  - `listExtensions(): Promise<ExtInfo[]>` →
    `pm().listConfiguredPackages().map(toExtInfo)`
  - `installExtension(source): Promise<void>` → guard `isValidSource`, then
    `await pm().installAndPersist(source)`
  - `removeExtension(source): Promise<void>` →
    `await pm().removeAndPersist(source)`
  - private lazy `pm()` building `DefaultPackageManager` with
    `cwd = resolveWorkspaceDir(await readJson("settings"))` and
    `agentDir = getAgentDir()`, one shared
    `SettingsManager.create(cwd, getAgentDir())`.
  - **verify:** `deno test -A src/lib/chat/extensions_test.ts` green;
    `deno check` clean.

## Task 2: Binding contract (frontend half)

**Files:** Modify `src/lib/chat/bindings.ts`.

- [ ] Add and export `type ExtInfo` (re-export from `extensions.ts`) and:
  ```typescript
  export interface ExtBindings {
    extList(): Promise<ExtInfo[]>;
    extInstall(arg: { source: string }): Promise<unknown>;
    extRemove(arg: { source: string }): Promise<unknown>;
  }
  export function extBindings(): ExtBindings | null {
    /* same globalThis.bindings pattern as chatBindings */
  }
  ```
- [ ] **verify:** `deno check` clean; existing `bindings_test.ts` still green.

## Task 3: Binding handlers (backend half)

**Files:** Modify `src/desktop.ts`.

- [ ] Add `let extensions: typeof import("./lib/chat/extensions.ts");` near the
      other `let` decls.
- [ ] Register BEFORE the top-level await (next to the `chat*` binds):
  ```typescript
  win.bind("extList", async () => await extensions.listExtensions());
  win.bind("extInstall", async (arg) => {
    await extensions.installExtension((arg as { source: string }).source);
    return true;
  });
  win.bind("extRemove", async (arg) => {
    await extensions.removeExtension((arg as { source: string }).source);
    return true;
  });
  ```
- [ ] Add `extensions = await import("./lib/chat/extensions.ts");` in the
      deps-load block.
- [ ] **verify:** `deno check src/desktop.ts` clean; `deno task build` succeeds.

## Task 4: Settings UI + restart (Decision 3 & 4)

**Files:** Modify `src/lib/settings/SettingsModal.svelte`.

- [ ] Add an "Extensions" section that on open calls `extBindings()?.extList()`
      and renders rows (`source`, `scope`, optional `path`).
- [ ] Source `<input>` + **Install** button. On click: show a daisyUI
      confirm/modal with the exact source string and the warning _"Extensions
      run code with full system access. Only install sources you trust."_
      (Decision 4). On confirm → `extInstall({ source })`, then re-list. Show
      errors inline (Decision 5).
- [ ] **Remove** button per row → `extRemove({ source })`, re-list.
- [ ] Restart affordance (Decision 3): after a successful install/remove, show
      "Restart chat modules to apply." Recommended minimal implementation: a
      note + let the user reopen the Chat module (which calls `chatStart`
      fresh). Auto-restart of open modules is optional follow-up (would need a
      workspace-level "restart chat agents" action touching
      `agent.ts`/Chat.svelte).
- [ ] Guard for web-dev: `extBindings()` is null under `deno task web`; the
      section shows "Desktop only".
- [ ] **verify:** `deno task build` clean; manual GUI check (needs a display —
      see Verification).

## Task 5: Docs & memory

- [ ] Note in a short `docs/` entry or the settings modal help text that global
      extensions are shared with the user's `pi` install (`~/.pi/agent`).
- [ ] Update memory `pi-extensions-loading.md` status to "install UI shipped"
      once merged.

---

## Verification

- Unit: `deno task test` (pure helpers in Task 1, unchanged existing suites).
- Type/build: `deno check` + `deno task build` clean.
- Integration (needs the GUI + network; GUI needs a display, per the chat-module
  spike note): install a tiny known pi package (e.g. a `pi-package`-tagged
  example), confirm it appears in `~/.pi/agent/settings.json` and
  `~/.pi/agent/npm/`, restart the Chat module, and confirm the extension's
  tool/command is available (e.g. via `chatListModels` if it registers a
  provider, or by invoking a registered command). If no display is available,
  verify the backend the UI drives: call
  `listExtensions`/`installExtension`/`removeExtension` directly under
  `deno run -A` and assert settings.json round-trips.

## Out of scope (future)

- Project-local `.pi/extensions/` + trust prompt (Decision 2).
- Auto-restart of all open chat agents on install.
- A browse/gallery UI over pi.dev/packages.
- RPC-subprocess isolation for native-dep extensions (tracked in the chat-module
  memory).
