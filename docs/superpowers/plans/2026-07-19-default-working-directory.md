# Default Working Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give pique a persisted default working directory (empty ⇒ `$HOME`)
that new terminals and chat agents spawn into, editable in Settings via a text
field plus a native folder picker.

**Architecture:** A new `workspace.defaultDir` field in the persisted `Settings`
(`~/.pique/settings.json`). Resolution is **backend-side**
(`resolveWorkspaceDir`, which knows `$HOME`), so the existing
`termStart`/`chatStart` binding contracts are untouched — the desktop handlers
read settings and pass `cwd` down into `startSession` and `startAgent`. The
native picker is a new `pickDirectory` binding that shells out to `kdialog`
(KDE) / `zenity` (GTK fallback) from the Deno backend and returns an absolute
path. Per-workspace overrides are explicitly out of scope.

**Tech Stack:** Deno desktop (webview backend, `win.bind` bridge), Svelte 5 +
daisyui, `@sigma/pty-ffi` (PTY, whose `CommandOptions.cwd` is a typed field —
verified), `@earendil-works/pi-coding-agent` (`createAgentSession({ cwd })` —
verified).

---

## File Structure

- **Modify** `src/lib/settings/bindings.ts` — add
  `workspace: { defaultDir?: string }` to `Settings`/`DEFAULT_SETTINGS`; add a
  frontend `pickDirectory()` accessor.
- **Modify** `src/lib/settings/store.ts` — extend the per-section hydrate merge
  to include `workspace`.
- **Modify** `src/lib/settings/file.ts` — add backend
  `resolveWorkspaceDir(settings)` (`$HOME` fallback lives here).
- **Modify** `src/lib/settings/file_test.ts` — tests for `resolveWorkspaceDir`.
- **Create** `src/lib/settings/dialog.ts` — backend native folder picker
  (kdialog/zenity) + pure `dirDialogCommand`.
- **Create** `src/lib/settings/dialog_test.ts` — tests for `dirDialogCommand`.
- **Modify** `src/lib/terminal/pty.ts` — `startSession` accepts and forwards
  `cwd`.
- **Create** `src/lib/terminal/pty_test.ts` — integration test that a spawned
  shell honors `cwd`.
- **Modify** `src/lib/chat/agent.ts` — `startAgent` resolves the workspace dir
  and passes `cwd` to `createAgentSession`.
- **Modify** `src/desktop.ts` — resolve `cwd` in `termStart`; add the
  `pickDirectory` binding + `dialog` module import.
- **Modify** `src/lib/settings/SettingsModal.svelte` — a "Workspace" section
  with the directory input + Browse button.

**Note on the backend/frontend contract:** `src/desktop.ts` (backend `win.bind`
handlers) and the `*/bindings.ts` files (frontend) are separate module graphs
with no compile-time cross-check — every binding arg/return shape must be kept
in sync by hand. This plan changes only one contract: the new `pickDirectory`
binding. `termStart`/`chatStart` shapes stay identical.

---

### Task 1: Add `workspace.defaultDir` to Settings

**Files:**

- Modify: `src/lib/settings/bindings.ts:9-23`
- Modify: `src/lib/settings/store.ts:33-38`

- [ ] **Step 1: Add the `workspace` section to the `Settings` interface and
      defaults**

In `src/lib/settings/bindings.ts`, change the `Settings` interface (currently
ends after the `chat` block) and `DEFAULT_SETTINGS`:

```ts
export interface Settings {
  version: number;
  appearance: { theme: string };
  chat: {
    defaultProvider?: string;
    defaultModel?: string;
    defaultThinkingLevel?: ThinkingLevel;
  };
  workspace: { defaultDir?: string };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: { theme: "catppuccin-frappe" },
  chat: { defaultThinkingLevel: "off" },
  workspace: {},
};
```

(`version` stays `1`: this is an additive optional section, and the per-section
merge below supplies the default for any stored file that predates it — no
migration needed, matching how `chat` was added.)

- [ ] **Step 2: Extend the hydrate merge to carry the `workspace` section**

In `src/lib/settings/store.ts`, the `hydrateSettings` `settings.set({...})` call
currently merges `appearance` and `chat`. Add `workspace`:

```ts
settings.set({
  version: DEFAULT_SETTINGS.version,
  appearance: { ...DEFAULT_SETTINGS.appearance, ...r.appearance },
  chat: { ...DEFAULT_SETTINGS.chat, ...r.chat },
  workspace: { ...DEFAULT_SETTINGS.workspace, ...r.workspace },
});
```

- [ ] **Step 3: Type-check the settings modules**

Run: `deno check src/lib/settings/store.ts` Expected: no errors (a stored file
missing `workspace` still type-checks because the merge always produces the
field).

- [ ] **Step 4: Commit**

```bash
git add src/lib/settings/bindings.ts src/lib/settings/store.ts
git commit -m "feat(settings): add workspace.defaultDir field"
```

---

### Task 2: Backend `resolveWorkspaceDir` helper

Resolution lives backend-side because the `$HOME` fallback needs `Deno.env`.
This mirrors `resolveChatDefaults` in `agent.ts` (pure projection of persisted
settings), but reads the environment for its fallback.

**Files:**

- Modify: `src/lib/settings/file.ts` (append after `writeJson`)
- Test: `src/lib/settings/file_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/settings/file_test.ts` (it already imports from `./file.ts`
and `@std/assert` — add `resolveWorkspaceDir` to the existing import from
`./file.ts`, and `assertEquals` if not already imported):

```ts
Deno.test("resolveWorkspaceDir returns defaultDir when it is a non-empty string", () => {
  assertEquals(
    resolveWorkspaceDir({ workspace: { defaultDir: "/proj/x" } }),
    "/proj/x",
  );
});

Deno.test("resolveWorkspaceDir falls back to $HOME for unset/blank/non-string", () => {
  const home = Deno.env.get("HOME");
  assertEquals(resolveWorkspaceDir(null), home);
  assertEquals(resolveWorkspaceDir({}), home);
  assertEquals(resolveWorkspaceDir({ workspace: {} }), home);
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "" } }), home);
  assertEquals(resolveWorkspaceDir({ workspace: { defaultDir: "   " } }), home);
  // deno-lint-ignore no-explicit-any
  assertEquals(
    resolveWorkspaceDir({ workspace: { defaultDir: 42 as any } }),
    home,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A src/lib/settings/file_test.ts` Expected: FAIL —
`resolveWorkspaceDir is not a function` / not exported.

- [ ] **Step 3: Implement `resolveWorkspaceDir`**

Append to `src/lib/settings/file.ts`:

```ts
// Effective working directory for spawned shells and chat agents: the persisted
// workspace.defaultDir when it is a non-empty string, else $HOME. `settings` is
// whatever readJson("settings") returned — possibly null, missing the section,
// or holding a non-string — so every field is guarded (mirrors resolveChatDefaults).
export function resolveWorkspaceDir(settings: Json): string {
  const home = Deno.env.get("HOME") ?? "/";
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const ws = (settings as { [k: string]: Json }).workspace;
    if (ws && typeof ws === "object" && !Array.isArray(ws)) {
      const dir = (ws as { [k: string]: Json }).defaultDir;
      if (typeof dir === "string" && dir.trim() !== "") return dir;
    }
  }
  return home;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/settings/file_test.ts` Expected: PASS (both new tests
plus the existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings/file.ts src/lib/settings/file_test.ts
git commit -m "feat(settings): add resolveWorkspaceDir with \$HOME fallback"
```

---

### Task 3: Spawn terminals in the resolved directory

**Files:**

- Modify: `src/lib/terminal/pty.ts:11-21`
- Test: `src/lib/terminal/pty_test.ts` (create)
- Modify: `src/desktop.ts:22-25`

- [ ] **Step 1: Write the failing integration test**

Create `src/lib/terminal/pty_test.ts`. This drives a real PTY (as verified
during planning: a shell spawned with `cwd: "/tmp"` reports `/tmp` from `pwd`):

```ts
import { assertStringIncludes } from "@std/assert";
import { killSession, readSession, startSession, writeSession } from "./pty.ts";

Deno.test("startSession spawns the shell in the given cwd", async () => {
  const id = startSession({ cols: 80, rows: 24, cwd: "/tmp" });
  writeSession(id, "pwd\n");
  let out = "";
  for (let i = 0; i < 300 && !out.includes("/tmp"); i++) {
    const { data } = readSession(id);
    if (data.length) out += new TextDecoder().decode(data);
    await new Promise((r) => setTimeout(r, 10));
  }
  killSession(id);
  assertStringIncludes(out, "/tmp");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/terminal/pty_test.ts` Expected: FAIL — `startSession`
does not accept `cwd`, so the shell starts in the process cwd (the project dir),
and `/tmp` never appears (test times out and asserts false).

- [ ] **Step 3: Add `cwd` to `startSession`**

In `src/lib/terminal/pty.ts`, change the signature and the `Pty` options:

```ts
/** Spawn the user's shell in a PTY at the given size and cwd; returns a session id. */
export function startSession(
  opts: { cols: number; rows: number; cwd?: string },
): string {
  const shell = Deno.env.get("SHELL") ?? "bash";
  const pty = new Pty(shell, {
    args: ["-i"],
    env: { TERM: "xterm-256color" },
    cwd: opts.cwd,
    size: { rows: opts.rows, cols: opts.cols },
  });
  const id = `t${++counter}`;
  sessions.set(id, { pty });
  return id;
}
```

(`CommandOptions.cwd?: string` is optional — passing `undefined` keeps the
library's "current working directory" default, so non-desktop/test callers that
omit it are unaffected.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A src/lib/terminal/pty_test.ts` Expected: PASS.

- [ ] **Step 5: Resolve and pass `cwd` from the `termStart` binding**

In `src/desktop.ts`, update the `termStart` handler (the `settings` module is
already imported and provides `readJson`; add the new `resolveWorkspaceDir`):

```ts
win.bind("termStart", async (arg) => {
  const { cols, rows } = arg as { cols: number; rows: number };
  const cwd = settings.resolveWorkspaceDir(await settings.readJson("settings"));
  return { id: term.startSession({ cols, rows, cwd }) };
});
```

No change is needed to `src/lib/terminal/bindings.ts` or `Terminal.svelte` — the
`termStart` arg/return shapes are unchanged.

- [ ] **Step 6: Verify the full test suite still passes**

Run: `deno test -A src/` Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add src/lib/terminal/pty.ts src/lib/terminal/pty_test.ts src/desktop.ts
git commit -m "feat(terminal): spawn shell in the resolved working directory"
```

---

### Task 4: Start chat agents in the resolved directory

`createAgentSession` accepts `cwd` (verified:
`CreateAgentSessionOptions.cwd?: string`, "Working directory for project-local
discovery. Default: process.cwd()"). `startAgent` already reads
`readJson("settings")` for chat defaults — reuse that single read for the
workspace dir too.

**Files:**

- Modify: `src/lib/chat/agent.ts:52` (import) and `:83-96` (`startAgent`)

- [ ] **Step 1: Import `resolveWorkspaceDir`**

In `src/lib/chat/agent.ts`, change the existing import from
`../settings/file.ts`:

```ts
import { readJson, resolveWorkspaceDir } from "../settings/file.ts";
```

- [ ] **Step 2: Resolve `cwd` from the settings read and pass it to
      `createAgentSession`**

In `startAgent`, capture the settings once and thread `cwd` through:

```ts
const rawSettings = await readJson("settings");
const { provider, modelId, thinking } = resolveChatDefaults(rawSettings);
const cwd = resolveWorkspaceDir(rawSettings);
const model = modelRuntime.getModel(provider, modelId) ??
  modelRuntime.getModel(FALLBACK_PROVIDER, FALLBACK_MODEL);
const created = await createAgentSession({
  model,
  cwd,
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});
```

(The explicit `sessionManager: SessionManager.inMemory()` still overrides the
default session manager; `cwd` only drives project-local discovery, which is the
intended effect.)

- [ ] **Step 3: Type-check the chat agent**

Run: `deno check src/lib/chat/agent.ts` Expected: no errors.

- [ ] **Step 4: Verify the full test suite still passes**

Run: `deno test -A src/` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/agent.ts
git commit -m "feat(chat): start agent in the resolved working directory"
```

---

### Task 5: Native folder picker (`pickDirectory`)

Shells out to the platform folder dialog. This box is KDE (`kdialog` present)
with `zenity` as a GTK fallback. `dirDialogCommand` is a pure argv builder
(unit-tested); the async wrapper tries `kdialog` first and falls through to
`zenity` only when the binary is missing (a spawn error), not when the user
cancels.

**Files:**

- Create: `src/lib/settings/dialog.ts`
- Test: `src/lib/settings/dialog_test.ts`
- Modify: `src/desktop.ts` (module import list, new binding, deferred import)
- Modify: `src/lib/settings/bindings.ts` (frontend `pickDirectory` accessor)

- [ ] **Step 1: Write the failing tests for the argv builder**

Create `src/lib/settings/dialog_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { dirDialogCommand } from "./dialog.ts";

Deno.test("dirDialogCommand builds the kdialog argv", () => {
  assertEquals(dirDialogCommand("kdialog", "/home/me/proj"), {
    cmd: "kdialog",
    args: ["--getexistingdirectory", "/home/me/proj"],
  });
});

Deno.test("dirDialogCommand builds the zenity argv", () => {
  assertEquals(dirDialogCommand("zenity", "/home/me/proj"), {
    cmd: "zenity",
    args: ["--file-selection", "--directory", "--filename=/home/me/proj/"],
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A src/lib/settings/dialog_test.ts` Expected: FAIL —
`./dialog.ts` does not exist.

- [ ] **Step 3: Implement the picker**

Create `src/lib/settings/dialog.ts`:

```ts
// Backend native directory picker. deno desktop's webview backend exposes no
// folder-dialog API, so we shell out to the platform dialog: kdialog on KDE,
// zenity (GTK) as a fallback. Deno-side only; invoked via the pickDirectory
// win.bind in src/desktop.ts. Returns an absolute path, or null on cancel.

export type Picker = "kdialog" | "zenity";

// Pure argv builder, unit-tested in isolation so the shell-out wrapper stays thin.
// kdialog prints the chosen path on stdout and exits non-zero on cancel; zenity
// behaves the same and takes the start dir as a trailing-slash --filename.
export function dirDialogCommand(picker: Picker, startDir: string): {
  cmd: string;
  args: string[];
} {
  if (picker === "kdialog") {
    return { cmd: "kdialog", args: ["--getexistingdirectory", startDir] };
  }
  return {
    cmd: "zenity",
    args: ["--file-selection", "--directory", `--filename=${startDir}/`],
  };
}

// Run one picker. Cancel (non-zero exit) or empty selection → null. A missing
// binary makes Deno.Command().output() throw, which propagates so pickDirectory
// can try the next picker.
async function runPicker(
  picker: Picker,
  startDir: string,
): Promise<string | null> {
  const { cmd, args } = dirDialogCommand(picker, startDir);
  const out = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return null;
  const path = new TextDecoder().decode(out.stdout).trim();
  return path === "" ? null : path;
}

export async function pickDirectory(startDir: string): Promise<string | null> {
  for (const picker of ["kdialog", "zenity"] as const) {
    try {
      return await runPicker(picker, startDir);
    } catch {
      // Binary not installed — fall through to the next picker.
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/settings/dialog_test.ts` Expected: PASS (the two
`dirDialogCommand` tests; `pickDirectory` itself is verified manually in Task 6
since it needs a display).

- [ ] **Step 5: Register the `pickDirectory` backend binding**

In `src/desktop.ts`, add the module handle alongside the others (near
`let settings: ...`):

```ts
let dialog: typeof import("./lib/settings/dialog.ts");
```

Add the binding (place it next to the `config*` bindings, before the `close`
listener). If `startDir` is blank, open the dialog at the currently-resolved
workspace dir:

```ts
win.bind("pickDirectory", async (arg) => {
  const { startDir } = arg as { startDir?: string };
  const start = startDir && startDir.trim() !== ""
    ? startDir
    : settings.resolveWorkspaceDir(await settings.readJson("settings"));
  const path = await dialog.pickDirectory(start);
  return path ? { path } : null;
});
```

Add the deferred import alongside the other post-binding imports (near
`settings = await import(...)`):

```ts
dialog = await import("./lib/settings/dialog.ts");
```

- [ ] **Step 6: Add the frontend `pickDirectory` accessor**

In `src/lib/settings/bindings.ts`, add below the existing config accessors:

```ts
interface DialogBindings {
  pickDirectory(arg: { startDir?: string }): Promise<{ path: string } | null>;
}

// Opens the native folder picker via the desktop backend. Null in web-dev (no
// bindings) and on cancel — callers keep the current value in both cases.
export async function pickDirectory(startDir?: string): Promise<string | null> {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  const res = await (b as DialogBindings | undefined)?.pickDirectory({
    startDir,
  });
  return res?.path ?? null;
}
```

- [ ] **Step 7: Verify the full test suite passes and modules type-check**

Run: `deno test -A src/ && deno check src/lib/settings/bindings.ts` Expected:
PASS / no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/settings/dialog.ts src/lib/settings/dialog_test.ts src/desktop.ts src/lib/settings/bindings.ts
git commit -m "feat(settings): add native folder picker binding"
```

---

### Task 6: Settings UI — Workspace section

**Files:**

- Modify: `src/lib/settings/SettingsModal.svelte:1-2` (imports) and `:30-47`
  (add section)

- [ ] **Step 1: Import the picker accessor**

In `src/lib/settings/SettingsModal.svelte`, add to the `<script>` block below
the existing store import:

```ts
import { pickDirectory } from "./bindings.ts";

async function browse(): Promise<void> {
  const dir = await pickDirectory($settings.workspace.defaultDir);
  if (dir) $settings.workspace.defaultDir = dir;
}
```

- [ ] **Step 2: Add the Workspace section to the modal body**

In the `<div class="p-5">` block, after the existing Appearance row (the closing
`</div>` of the theme row), add:

```svelte
<div class="mt-6 mb-3 text-xs uppercase tracking-wide text-primary">Workspace</div>
<div>
  <div class="text-sm">Default working directory</div>
  <div class="mt-0.5 text-xs opacity-70">
    Where new terminals and chat agents start. Empty means your home directory.
    Applies to sessions opened after the change.
  </div>
  <div class="mt-2 flex gap-2">
    <input
      class="input input-bordered input-sm flex-1"
      placeholder="~ (home directory)"
      aria-label="Default working directory"
      bind:value={$settings.workspace.defaultDir}
    />
    <button type="button" class="btn btn-sm" onclick={browse}>Browse…</button>
  </div>
</div>
```

(Binding to a possibly-`undefined` field renders an empty input; typing sets a
string, and clearing it back to `""` is treated as unset by
`resolveWorkspaceDir`, so it falls through to `$HOME`.)

- [ ] **Step 3: Build the frontend to type-check the component**

Run: `deno run -A npm:vite build` Expected: build succeeds with no Svelte/TS
errors.

- [ ] **Step 4: Manual end-to-end verification**

Run: `deno task dev` Then verify:

1. Open Settings (gear button or `Ctrl+,`) → the **Workspace** section shows the
   directory field.
2. Click **Browse…** → the native KDE folder dialog opens; pick a directory →
   the field fills with its absolute path; cancel → the field is unchanged.
3. Close Settings, open a **new terminal tab**, run `pwd` → prints the chosen
   directory.
4. Clear the field (empty), open another terminal → `pwd` prints `$HOME`.
5. Open a **new chat** and ask it to run a shell command like `pwd`/`ls` → it
   operates in the chosen directory.
6. Confirm `~/.pique/settings.json` contains
   `"workspace": { "defaultDir": "…" }` and that the value survives an app
   restart.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings/SettingsModal.svelte
git commit -m "feat(settings): add default working directory UI"
```

---

## Self-Review Notes

- **Spec coverage:** default dir persisted (Task 1) with `$HOME` fallback (Task
  2); terminals honor it (Task 3); chat agents honor it (Task 4); native picker
  (Task 5); UI field + Browse (Task 6). Per-workspace override intentionally
  excluded per the agreed scope.
- **Type consistency:** `resolveWorkspaceDir(settings: Json): string` is defined
  in Task 2 and used verbatim in Tasks 3–5; `startSession({ cols, rows, cwd })`
  defined in Task 3 and called with that exact shape in `desktop.ts`;
  `pickDirectory(startDir?: string): Promise<string | null>` (frontend) and
  `pickDirectory(startDir: string): Promise<string | null>` (backend
  `dialog.ts`) are distinct modules — the backend takes a resolved non-optional
  `startDir`, the frontend accessor an optional one, matching their call sites.
- **Contract sync:** only the `pickDirectory` binding is added to both
  `desktop.ts` and `bindings.ts`; `termStart`/`chatStart` shapes are unchanged,
  so no frontend terminal/chat code is touched.
