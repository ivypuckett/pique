# Library Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Settings → Extensions and Settings → Prompts out of the settings
modal into a new right-column module named "Library", with two sub-tabs.

**Architecture:** A new module kind `library` joins the registry alongside
terminal/chat/filetree/gitdiff/kanban. `library/Library.svelte` is a thin shell
owning sub-tab state, scope selection (copied from `Kanban.svelte`'s pattern)
and a refresh counter. The two sections move verbatim out of the modal into
`extensions/Extensions.svelte` and `prompts/Prompts.svelte`, beside the
`bindings.ts` they already call, taking `scope` as a prop instead of reading a
global store. No service, binding, or on-disk behaviour changes.

**Tech Stack:** Deno, Svelte 5 (runes: `$props`, `$state`, `$derived`,
`$effect`), Tailwind + daisyUI, `deno test`.

**Spec:**
[2026-08-03-library-module-design.md](../specs/2026-08-03-library-module-design.md)

---

## Background for the engineer

Read these before starting. They explain vocabulary this plan uses without
re-deriving it.

- **Scope** — pique has a root workspace plus per-workspace scopes; a workspace
  inherits root's extensions and prompt templates but can never see a sibling's.
  `ROOT` is exported from `src/lib/scope/paths.ts`. See
  [docs/scopes.md](../../scopes.md).
- **Extensions** — user- or agent-authored code that gets reviewed before it can
  run. See [docs/extensions.md](../../extensions.md).
- **Prompt templates** — reusable messages invoked as `/name` in chat. See
  [docs/prompts.md](../../prompts.md).
- **Modules** — the tabbed panes in the right column. `src/lib/Column.svelte:76`
  renders each one from `src/lib/modules/registry.ts` with the props
  `{ title, cwd, workspaceId, viewId, tabId }` plus anything in `tab.props`.
  Inactive tabs stay **mounted** and are hidden with a CSS class
  (`Column.svelte:73`) — this is why the module needs an explicit refresh
  control, since `onMount` fires only once.
- **Web mode vs desktop** — `deno task web` has no backend, so
  `extensionBindings()` and `promptBindings()` return `null` and the UI shows
  "Available in the desktop app only." See
  [docs/agent-verification.md](../../agent-verification.md).

### The one subtle trap in this plan

`Kanban.svelte` uses `inRoot` to mean _this module is in the root workspace_
(used to hide the scope toggle). The settings modal uses `inRoot` to mean _the
scope currently being viewed is root_ (used for copy like "Enabling here grants
it to every workspace"). **These are different when a workspace is viewing
root's list.** The shell therefore computes both, under different names, and
passes the second one down. Getting this wrong silently shows the wrong warning
text. Task 1 defines both.

### Verification commands used throughout

```bash
deno task test
```

```bash
deno fmt
```

`deno lint` reports 30 pre-existing problems in this repo and is **not** a gate.
Do not try to fix them; just don't add more.

---

## File structure

| File                                    | Change | Responsibility                                        |
| --------------------------------------- | ------ | ----------------------------------------------------- |
| `src/lib/library/Library.svelte`        | Create | Shell: sub-tabs, scope selection, refresh counter     |
| `src/lib/extensions/Extensions.svelte`  | Create | Extensions section (moved from the modal)             |
| `src/lib/prompts/Prompts.svelte`        | Create | Prompts section (moved from the modal)                |
| `src/lib/modules/registry.ts`           | Modify | Register `library`                                    |
| `src/lib/layout_test.ts`                | Modify | Pin the module label and tab title                    |
| `src/lib/settings/SettingsModal.svelte` | Modify | Delete both sections and all scope machinery          |
| `src/lib/scope/store.ts`                | Modify | Delete `editing` / `editScope`; trim `patchScopeChat` |
| `src/lib/extensions/agent-tools.ts`     | Modify | Retarget three "Settings → Extensions" strings        |
| `src/lib/prompts/agent-tools.ts`        | Modify | Retarget three "Settings → Prompts" strings           |
| `docs/*.md`                             | Modify | Retarget human-facing references                      |

---

## Task 1: Register the Library module with a placeholder shell

Establishes the module end-to-end — registry, `+` menu, tab title — before any
UI moves. After this task the module opens and shows two empty sub-tabs.

**Files:**

- Create: `src/lib/library/Library.svelte`
- Modify: `src/lib/modules/registry.ts`
- Test: `src/lib/layout_test.ts`

- [ ] **Step 1: Write the failing test**

Append to the end of `src/lib/layout_test.ts`:

```ts
Deno.test("library is a module kind with a capitalised label", () => {
  assertEquals(moduleLabel("library"), "Library");
});

Deno.test("addTab opens a Library tab titled Library", () => {
  const v = addTab(createInitialView(), "library");
  const tab = v.right.rows[v.right.rows.length - 1];
  assertEquals(tab.kind, "library");
  assertEquals(tab.title, "Library");
  assertEquals(v.right.activeTabId, tab.id);
});
```

`moduleLabel` is not yet imported by this test file. Add it to the **first**
import block (the one that already imports `createInitialView`), keeping the
list alphabetical:

```ts
import {
  createInitialView,
  fixedPx,
  gridTemplateColumns,
  MIN_WIDTH_PCT,
  moduleLabel,
  resizeBoundary,
  visibleIds,
} from "./layout.ts";
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
deno test -A src/lib/layout_test.ts
```

Expected: FAIL — `moduleLabel` is not exported from the first import block until
you add it, so the failure is a TypeScript error on the import. If you already
added the import in step 1, both new tests should instead **pass** immediately:
`moduleLabel` derives "Library" from the string `"library"` with no table entry
needed (`layout.ts:148-150`), and `addTab` is kind-agnostic.

**This is expected and correct.** These two tests are regression pins, not
red-green drivers — they exist so that a future `LABELS` entry or `addTab`
change cannot silently rename the module. Note the result and continue; do not
invent a failure by breaking `layout.ts`.

- [ ] **Step 3: Create the shell**

Create `src/lib/library/Library.svelte`:

```svelte
<script lang="ts">
  import { ROOT } from "../scope/paths.ts";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  // Which scope this module acts on: its own workspace's, or the shared root one it
  // inherits from. Root itself has nothing else to switch to, so the toggle is hidden
  // there — same shape as Kanban's board switcher.
  const isRootWorkspace = $derived(workspaceId === ROOT);
  let showRoot = $state(false);
  const scope = $derived(isRootWorkspace || showRoot ? ROOT : workspaceId);
  // NOT the same as isRootWorkspace: a workspace viewing root's list is editing root.
  // The sections use this to say whether a change reaches every workspace.
  const scopeIsRoot = $derived(scope === ROOT);

  let tab = $state<"extensions" | "prompts">("extensions");

  // A module tab stays mounted when it is not the active one (Column.svelte hides it
  // with a class), so there is no re-open to re-list on the way the modal had. Bumping
  // this counter is how the shell asks the sections to re-read; they also re-read when
  // the scope changes.
  let refreshKey = $state(0);
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-3 py-1.5">
    <button
      class="btn btn-ghost btn-xs"
      class:btn-active={tab === "extensions"}
      aria-pressed={tab === "extensions"}
      onclick={() => (tab = "extensions")}
    >Extensions</button>
    <button
      class="btn btn-ghost btn-xs"
      class:btn-active={tab === "prompts"}
      aria-pressed={tab === "prompts"}
      onclick={() => (tab = "prompts")}
    >Prompts</button>

    {#if !isRootWorkspace}
      <span class="ml-3 mr-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">Scope</span>
      <button
        class="btn btn-ghost btn-xs"
        class:btn-active={!showRoot}
        aria-pressed={!showRoot}
        onclick={() => (showRoot = false)}
      >Workspace</button>
      <button
        class="btn btn-ghost btn-xs"
        class:btn-active={showRoot}
        aria-pressed={showRoot}
        onclick={() => (showRoot = true)}
      >Root</button>
    {/if}

    <button
      class="btn btn-ghost btn-xs ml-auto"
      aria-label="Refresh"
      title="Re-read this scope's extensions and templates"
      onclick={() => refreshKey++}
    >↻</button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    {#if tab === "extensions"}
      <div class="text-xs opacity-60">Extensions — scope {scope}, refresh {refreshKey}, root {scopeIsRoot}</div>
    {:else}
      <div class="text-xs opacity-60">Prompts — scope {scope}, refresh {refreshKey}, root {scopeIsRoot}</div>
    {/if}
  </div>
</div>
```

The placeholder bodies are replaced in Tasks 2 and 3. They render `scope`,
`refreshKey` and `scopeIsRoot` deliberately, so this task can be verified by
eye.

- [ ] **Step 4: Register it**

In `src/lib/modules/registry.ts`, add the import beneath the existing ones and
the entry at the end of the record:

```ts
import Library from "../library/Library.svelte";
```

```ts
  kanban: Kanban,
  library: Library,
};
```

`TabStrip.svelte` needs no change — it lists every registry key except `chat`
and `filetree` (`TabStrip.svelte:15`).

- [ ] **Step 5: Run the tests and the formatter**

Run:

```bash
deno task test
```

Expected: PASS, including the two new `layout_test.ts` cases.

Run:

```bash
deno fmt
```

Expected: reformats at most the files you touched.

- [ ] **Step 6: Commit**

```bash
git add src/lib/library/Library.svelte src/lib/modules/registry.ts src/lib/layout_test.ts
git commit -m "Add Library module shell"
```

---

## Task 2: Move the Extensions section into the module

**Files:**

- Create: `src/lib/extensions/Extensions.svelte`
- Modify: `src/lib/library/Library.svelte`
- Source to copy from: `src/lib/settings/SettingsModal.svelte`

This is a **move, not a rewrite**. Copy the marked ranges verbatim, then apply
only the substitutions listed. Do not reword copy, rename variables, or
restructure markup — a behaviour change here would be indistinguishable from a
move bug.

- [ ] **Step 1: Create the component with its script block**

Create `src/lib/extensions/Extensions.svelte`. Start with this script header:

```svelte
<script lang="ts">
  import {
    type Extension,
    extensionBindings,
    type ExtensionSource,
    type ExtSearchResult,
  } from "./bindings.ts";

  // `scope` is the scope the Library module is pointed at; `inRoot` says whether that
  // scope is root, which changes what enabling here reaches. `refreshKey` is bumped by
  // the shell's Refresh button — re-read on any of them changing.
  let { scope, inRoot, refreshKey }: { scope: string; inRoot: boolean; refreshKey: number } =
    $props();

  const ext = extensionBindings();
  let visible = $state<Extension[]>([]);
  let source = $state("");
  let busy = $state(false);
  let extError = $state("");
  let extNotice = $state("");
  // Guards the FETCH, not the enable: downloading an npm package runs its install
  // scripts, which happens before any review is possible (see docs/extensions.md).
  let confirming = $state(false);
</script>
```

- [ ] **Step 2: Copy the rest of the script from the modal**

From `src/lib/settings/SettingsModal.svelte`, copy these ranges into the script
block, in this order, keeping their comments:

| Lines     | What                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `128-144` | browse/review state (`query`, `results`, `searching`, `reviewing`, `reviewed`) and the `ownPending` / `ownEnabled` / `inherited` deriveds |
| `146-170` | `search()`, `addResult()`, `refreshExts()`                                                                                                |
| `200-255` | `confirmFetch()`, `extKey()`, `toggleReview()`, `extAction()`                                                                             |

Then add this effect in place of the modal's lines `179-189` (the
`$settingsOpen`-gated one). The modal re-listed whenever it opened; this
re-lists whenever the scope changes or Refresh is pressed:

```ts
// Re-list when the scope changes or the shell asks for a refresh — both change what
// this list should show. Clears stale notices and collapses any open review.
$effect(() => {
  refreshKey;
  if (ext && scope) {
    extError = "";
    extNotice = "";
    confirming = false;
    reviewing = null;
    refreshExts();
  }
});
```

The bare `refreshKey;` statement is a deliberate dependency read — Svelte 5
tracks it so the effect re-runs when the counter changes. Do not delete it as
dead code.

- [ ] **Step 3: Copy the markup**

Below the script, add the markup. Copy modal lines `625-659` (the `reviewPane`
snippet, including the four-line comment above it) and lines `662-876` — that
is, the contents of the `{#if section === "extensions"}` block **without** its
`{#if}` / `{/if}` wrapper, since the module's sub-tab now does that job.

Apply exactly these substitutions to the copied markup:

1. Delete the section heading line (modal line `662`):
   ```svelte
   <div class="mb-3 text-xs uppercase tracking-wide text-primary">Extensions</div>
   ```
   The shell's sub-tab already names the section.
2. Everything else — including the `{#if !ext}` desktop-only branch, the
   Awaiting review / Enabled / Inherited lists, the search box, the fetch
   confirm, and the notice/error lines — is copied unchanged.

The `reviewPane` snippet must be defined before its first
`{@render reviewPane()}` call, same as in the modal.

- [ ] **Step 4: Wire it into the shell**

In `src/lib/library/Library.svelte`, add the import:

```svelte
import Extensions from "../extensions/Extensions.svelte";
```

and replace the extensions placeholder line with the component:

```svelte
{#if tab === "extensions"}
  <Extensions {scope} inRoot={scopeIsRoot} {refreshKey} />
{:else}
```

Note `inRoot={scopeIsRoot}` — see "The one subtle trap" above.

- [ ] **Step 5: Verify it builds and the suites stay green**

Run:

```bash
deno task build
```

Expected: a clean Vite build. This is what catches a Svelte syntax error or a
missing import in the copied markup — there are no component tests.

Run:

```bash
deno task test
```

Expected: PASS. Nothing below the UI changed, so any failure here means
something was moved that should not have been.

Run:

```bash
deno fmt
```

- [ ] **Step 6: Commit**

The modal still has its own copy at this point; Task 4 removes it. Each commit
leaves a working tree.

```bash
git add src/lib/extensions/Extensions.svelte src/lib/library/Library.svelte
git commit -m "Move Extensions section into the Library module"
```

---

## Task 3: Move the Prompts section into the module

**Files:**

- Create: `src/lib/prompts/Prompts.svelte`
- Modify: `src/lib/library/Library.svelte`
- Source to copy from: `src/lib/settings/SettingsModal.svelte`

Same rules as Task 2: verbatim move, listed substitutions only.

- [ ] **Step 1: Create the component with its script header**

Create `src/lib/prompts/Prompts.svelte`:

```svelte
<script lang="ts">
  import { promptBindings, type PromptInfo } from "./bindings.ts";
  import { refreshChatCommands } from "../chat/store.ts";

  // Same three props as the Extensions section: the scope the module points at, whether
  // that scope is root, and the shell's refresh counter.
  let { scope, inRoot, refreshKey }: { scope: string; inRoot: boolean; refreshKey: number } =
    $props();

  // A template is inert text the user has to type the name of, so there is nothing for a
  // human to approve to themselves: editing here writes straight to live, and the pending
  // list holds agent-written ones only.
  const prompts = promptBindings();
  let ownPrompts = $state<PromptInfo[]>([]);
  let rootPrompts = $state<PromptInfo[]>([]);
  let promptError = $state("");
  let promptNotice = $state("");
  let promptBusy = $state(false);
  let openPrompt = $state<string | null>(null);
  // The edit/create form, or null when none is open. `creating` decides whether the name
  // is still editable — renaming an existing template would leave the old file behind.
  let draft = $state<
    { name: string; description: string; argumentHint: string; body: string; creating: boolean } | null
  >(null);
</script>
```

- [ ] **Step 2: Copy the rest of the script from the modal**

From `src/lib/settings/SettingsModal.svelte`, copy these ranges into the script
block, in order, keeping their comments:

| Lines     | What                                                                                      |
| --------- | ----------------------------------------------------------------------------------------- |
| `274-289` | the `pendingPrompts` / `livePrompts` / `inheritedPrompts` deriveds and `refreshPrompts()` |
| `301-353` | `promptKey()`, `promptAction()`, `editPrompt()`, `newPrompt()`, `saveDraft()`             |

Then add this effect in place of the modal's lines `291-299`:

```ts
$effect(() => {
  refreshKey;
  if (prompts && scope) {
    promptError = "";
    promptNotice = "";
    openPrompt = null;
    draft = null;
    refreshPrompts();
  }
});
```

As in Task 2, the bare `refreshKey;` is a deliberate dependency read.

- [ ] **Step 3: Copy the markup**

Copy modal lines `880-1074` — the contents of the `{#if section === "prompts"}`
block **without** its `{#if}` / `{/if}` wrapper.

Apply exactly this substitution:

1. Delete the section heading line (modal line `880`):
   ```svelte
   <div class="mb-3 text-xs uppercase tracking-wide text-primary">Prompts</div>
   ```

Everything else — the desktop-only branch, the `$1` / `$@` explainer, Awaiting
review, the draft form, Available, Inherited from Root, and the notice/error
lines — is copied unchanged.

- [ ] **Step 4: Wire it into the shell**

In `src/lib/library/Library.svelte`, add the import:

```svelte
import Prompts from "../prompts/Prompts.svelte";
```

and replace the prompts placeholder branch:

```svelte
{:else}
  <Prompts {scope} inRoot={scopeIsRoot} {refreshKey} />
{/if}
```

- [ ] **Step 5: Verify**

Run:

```bash
deno task build
```

Expected: clean build.

Run:

```bash
deno task test
```

Expected: PASS.

Run:

```bash
deno fmt
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompts/Prompts.svelte src/lib/library/Library.svelte
git commit -m "Move Prompts section into the Library module"
```

---

## Task 4: Strip the settings modal and the scope store

The duplicate UI now goes. This is the task that shrinks `SettingsModal.svelte`
from ~1080 lines to roughly 350.

**Files:**

- Modify: `src/lib/settings/SettingsModal.svelte`
- Modify: `src/lib/scope/store.ts`

- [ ] **Step 1: Delete the moved script state from the modal**

In `src/lib/settings/SettingsModal.svelte`, delete these ranges (work
**bottom-up** so earlier line numbers stay valid):

| Lines     | What to delete                                                                                |
| --------- | --------------------------------------------------------------------------------------------- |
| `257-353` | the entire Prompts block (const `prompts` through `saveDraft()`)                              |
| `200-255` | `confirmFetch()`, `extKey()`, `toggleReview()`, `extAction()`                                 |
| `172-189` | the `editScope` effect and the extensions re-list effect                                      |
| `128-170` | browse/review state, the three extension deriveds, `search()`, `addResult()`, `refreshExts()` |
| `27-39`   | the extensions state block (const `ext` through `confirming`)                                 |
| `16-25`   | the `scopes` / `scope` / `inRoot` deriveds and their comment                                  |

Keep the providers block (`41-126` and the effect at `191-198`) and everything
from `355` down.

- [ ] **Step 2: Delete the now-unused imports**

Delete these four import statements (modal lines `4-14`), keeping the
`settings`/`settingsOpen`/`THEMES` import on line 2 and the provider import on
line 3:

```ts
import {
  type Extension,
  extensionBindings,
  type ExtensionSource,
  type ExtSearchResult,
} from "../extensions/bindings.ts";
import { promptBindings, type PromptInfo } from "../prompts/bindings.ts";
import { refreshChatCommands } from "../chat/store.ts";
import { editing, editScope } from "../scope/store.ts";
import { ROOT } from "../scope/paths.ts";
import { activeWorkspace } from "../store.ts";
```

- [ ] **Step 3: Shrink `SECTIONS` and drop `SCOPED_SECTIONS`**

Replace the `SECTIONS` block near the end of the script with:

```ts
// Side-pane navigation: one entry per settings header. The right pane shows
// only the selected section, so the modal stops spilling over vertically.
const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "workspace", label: "Workspace" },
  { id: "providers", label: "Providers" },
] as const;
let section = $state<(typeof SECTIONS)[number]["id"]>("appearance");
```

Delete the `SCOPED_SECTIONS` line and its comment entirely — with Extensions and
Prompts gone there is no scoped section left in the modal.

- [ ] **Step 4: Delete the moved markup**

Delete these ranges, again **bottom-up**:

| Lines      | What to delete                                    |
| ---------- | ------------------------------------------------- |
| `879-1075` | the whole `{#if section === "prompts"}` block     |
| `661-877`  | the whole `{#if section === "extensions"}` block  |
| `625-659`  | the `reviewPane` snippet and the comment above it |
| `412-431`  | the scope-selector strip and its comment          |

- [ ] **Step 5: Delete `editing` and `editScope` from the scope store**

In `src/lib/scope/store.ts`, delete the `Editing` interface, the `editing`
writable, and the `editScope` function. Update the file's opening comment, which
describes machinery that no longer exists — replace the whole header comment
with:

```ts
// Per-scope config helpers.
//
// A scope's config is read-modify-written against that scope's OWN file, never the
// resolved one — writing back inherited values would silently pin root's choices into
// the workspace.
```

Then trim `patchScopeChat`: delete its trailing `editing.update(...)` call and
the comment above it ("Keep the modal in sync…"), which now syncs nothing. The
function keeps its read-modify-write body and its `chat/store.ts` caller.

Leave `updateScopeConfig` alone. It is **already** unused before this change and
is not an orphan this work created; the spec records it as pre-existing.

- [ ] **Step 6: Verify the deletions left nothing dangling**

Run:

```bash
deno task build
```

Expected: clean build. A dangling import or a reference to a deleted variable
fails here.

Run:

```bash
grep -rn "editScope\|SCOPED_SECTIONS\|\$editing" src/
```

Expected: no output. If `editing` still appears in `scope/store.ts`, step 5 is
incomplete.

Run:

```bash
deno task test
```

Expected: PASS.

Run:

```bash
deno fmt
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/settings/SettingsModal.svelte src/lib/scope/store.ts
git commit -m "Drop Extensions and Prompts from the settings modal"
```

---

## Task 5: Retarget the agent-facing strings

These are strings the agent repeats back to the user, so they become wrong the
moment the sections move. No test asserts them — this is a source-only change,
verified by reading.

**Files:**

- Modify: `src/lib/extensions/agent-tools.ts`
- Modify: `src/lib/prompts/agent-tools.ts`

- [ ] **Step 1: Update `extensions/agent-tools.ts`**

Three places. In the file header comment (line 3):

```ts
// extension. Written source lands in the quarantine dir ONLY (paths.ts) — it cannot
// execute until a human reviews and enables it in the Library module's Extensions tab,
// which moves it into the auto-discovered extensions dir. Passed to createAgentSession
// as customTools (see chat/agent.ts). Runs Deno-side only.
```

In the tool description (line 43), replace
`"user reviews and enables it in
Settings → Extensions, and then only in chat sessions "`
with:

```ts
"user reviews and enables it in the Library module's Extensions tab, and then " +
"only in chat sessions " +
```

In the success message (line 70), replace
`` `must enable it in Settings →
Extensions, and it loads in chat sessions started ` ``
with:

```ts
`must enable it in the Library module's Extensions tab, and it loads in ` +
`chat sessions started ` +
```

- [ ] **Step 2: Update `prompts/agent-tools.ts`**

Three places. In the file header comment (line 4):

```ts
// ONLY (paths.ts) — pi's directory scan does not recurse, so nothing there is invocable
// until a human approves it in the Library module's Prompts tab, which moves it into the
// live dir.
```

In the tool description (line 35), replace
`"Settings → Prompts. Say so when
reporting back. A template is text that gets sent as "`
with:

```ts
"the Library module's Prompts tab. Say so when reporting back. A template is " +
"text that gets sent as " +
```

In the success message (line 79), replace
`` `invocable yet — the user must
approve it in Settings → Prompts.` `` with:

```ts
`invocable yet — the user must approve it in the Library module's Prompts tab.`,
```

- [ ] **Step 3: Verify no stale references remain in source**

Run:

```bash
grep -rn "Settings → Extensions\|Settings → Prompts" src/
```

Expected: no output.

Run:

```bash
deno task test
```

Expected: PASS.

Run:

```bash
deno fmt
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/extensions/agent-tools.ts src/lib/prompts/agent-tools.ts
git commit -m "Point agent-facing copy at the Library module"
```

---

## Task 6: Update the docs

**Files:**

- Modify: `docs/prompts.md`, `docs/scopes.md`, `docs/extensions.md`,
  `docs/agent-verification.md`

**Do not run a blanket find-and-replace on the word "Settings".**
`docs/extensions.md` refers to pi's own `SettingsManager` in many places
(`addSourceToSettings`, `setPackages`, "Settings writes are queued") — those are
a different Settings and must not change. Only the four lines listed below in
that file mean pique's UI, and one of them is a heading that stays.

- [ ] **Step 1: `docs/prompts.md` — four references**

Line 68, inside the lifecycle diagram:
`user reads the text in Settings →
Prompts` becomes:

```
user reads the text in Library → Prompts
```

Line 76: `Settings → Prompts is a full editor` becomes
`Library → Prompts is a
full editor`.

Line 145: `Settings marks a shadowed root template` becomes
`The Prompts tab
marks a shadowed root template`.

Line 163: `Settings lists and edits a scope's own templates only` becomes
`Library → Prompts lists and edits a scope's own templates only`.

- [ ] **Step 2: `docs/scopes.md` — one reference**

Line 167: `Settings → Extensions shows a scope's own extensions` becomes
`Library → Extensions shows a scope's own extensions`.

- [ ] **Step 3: `docs/extensions.md` — three references**

Line 17, in the origins table:
`Settings → Extensions, backed by pi's
\`DefaultPackageManager\``becomes`Library
→ Extensions, backed by pi's
\`DefaultPackageManager\``. Keep the table's column alignment (`deno fmt` will
fix it if you don't).

Line 91: `The Settings list labels the inherited group accordingly` becomes
`The Extensions list labels the inherited group accordingly`.

Line 214: `Settings → Extensions reviews, enables, revokes and deletes` becomes
`Library → Extensions reviews, enables, revokes and deletes`.

Leave the heading `### 4. Settings writes are queued, not synchronous` and every
`addSourceToSettings` / `removeSourceFromSettings` / `setPackages` mention
untouched — those are pi's settings, not pique's modal.

- [ ] **Step 4: `docs/agent-verification.md` — the web-mode checklist**

Line 33-34 currently reads:

```
- Settings modal UI and the theme switcher (applies live to
  `<html data-theme>`).
```

Replace with:

```
- Settings modal UI and the theme switcher (applies live to
  `<html data-theme>`).
- The Library module's chrome — the `+` menu entry, the Extensions/Prompts
  sub-tabs, the scope toggle. The lists themselves need the desktop app.
```

- [ ] **Step 5: Verify**

Run:

```bash
grep -rn "Settings → Extensions\|Settings → Prompts" docs/
```

Expected: no output.

Run:

```bash
deno fmt
```

Expected: may reflow the tables and lists you edited.

- [ ] **Step 6: Commit**

```bash
git add docs/prompts.md docs/scopes.md docs/extensions.md docs/agent-verification.md
git commit -m "Update docs for the Library module"
```

---

## Task 7: Manual verification

No component tests exist, so this is where the UI is actually proven. Follow
[docs/agent-verification.md](../../agent-verification.md) — in particular, **do
not take screenshots**; `computer` actions hang in this environment. Drive the
page with `read_page`, `find`, `form_input` and `javascript_tool`.

- [ ] **Step 1: Web mode — the module chrome**

Start the dev server:

```bash
deno run -A npm:vite
```

Or via the preview tool: `preview_start {name: "web"}`.

Check, using `read_page`:

1. The right column's `+` menu lists **Library** alongside Terminal, Git Diff
   and Kanban.
2. Clicking it opens a tab titled **Library**.
3. The Extensions and Prompts sub-tabs both switch, and the pressed one carries
   `aria-pressed="true"`.
4. Both sections show "Available in the desktop app only." — expected in web
   mode, same as Terminal and Chat.
5. The scope toggle is **absent** in the Root workspace and **present** after
   creating a second workspace.

- [ ] **Step 2: Web mode — the modal**

Open Settings (`ctrl+,`) and confirm via `read_page`:

1. The side nav lists exactly three entries: Appearance, Workspace, Providers.
2. No scope strip appears on any of them.
3. The theme switcher still applies live to `<html data-theme>`.

Check the console for errors:

```
read_console_messages {onlyErrors: true}
```

Expected: nothing from the Library module or the modal.

- [ ] **Step 2b: Confirm no regression in the desktop build**

```bash
deno task build
```

Expected: clean.

- [ ] **Step 3: Desktop — the part web mode cannot show**

The lists only have data with the real backend. This launches a native webview
window that **cannot be screenshotted or driven from the agent pane** — a human
runs this, or the agent runs it and reports that it must be checked by hand.

```bash
deno task dev
```

Confirm by hand:

1. Library → Extensions lists the scope's extensions; Review expands code and
   Enable is disabled until it does.
2. Library → Prompts lists templates; New/Edit/Save round-trips, and the saved
   template is invocable as `/name` in a Chat module without restarting it.
3. The scope toggle switches between the workspace's list and root's, and the
   Inherited groups appear only in a workspace.
4. In a workspace viewing **Root**, the review warning says the change reaches
   every workspace — this is the `inRoot` trap from the plan header. If it says
   the workspace-only wording, `inRoot={scopeIsRoot}` was wired wrong in Task
   2/3 step 4.
5. With the Library tab left open, have a chat agent call `define_prompt`, then
   press **Refresh** — the new template appears in Awaiting review. This is the
   behaviour the Refresh button exists for.

- [ ] **Step 4: Commit any fixes**

If steps 1-3 turn up defects, fix them and commit with a message describing the
defect, not the task number.

---

## Done when

- `deno task test` passes, including the two new `layout_test.ts` cases.
- `deno task build` is clean.
- `grep -rn "Settings → Extensions\|Settings → Prompts" src/ docs/` is empty.
- `grep -rn "editScope\|SCOPED_SECTIONS" src/` is empty.
- Library opens from the `+` menu, both sub-tabs work, and the scope toggle is
  hidden in root.
- Settings has three sections and no scope strip.
