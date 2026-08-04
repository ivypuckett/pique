# Library Module — Design

**Date:** 2026-08-03 **Status:** Designed

## Purpose

Move Settings → **Extensions** and Settings → **Prompts** out of the settings
modal and into a right-column module.

Everything else in the modal is an app-level toggle you set once: a theme, a
scan depth, a checkbox. Extensions and Prompts are neither — they are scoped,
list-heavy, and carry a review workflow with an editor attached. They also point
at the thing the modal is covering up: enabling an extension tells you to "open
a new Chat module to load it", and saving a template tells you to "type /name in
a chat".

[Kanban](2026-07-22-kanban-module.md) is the precedent — a scoped, stateful
surface that became a module and, in commit `a915677`, had its own settings
collapsed into the board.

## Scope

**In:**

- A new module kind, `library`, with **Extensions** and **Prompts** sub-tabs.
- The two sections moved out of `SettingsModal.svelte` into components that live
  beside the bindings they already call.
- Scope selection owned by the module instance, following `Kanban.svelte`.
- A refresh control, replacing the re-list that modal-open used to provide.
- Agent-facing and human-facing text that names Settings → Extensions/Prompts.

**Out:** Providers (stays in Settings — see decision 1); any change to the
extension or prompt lifecycle, bindings, services, or on-disk layout; a richer
prompt editor than the modal has today.

## Decisions

1. **Providers stays in Settings.** It is machine-wide and shared with the `pi`
   CLI — not scoped, not reviewed, set once. Putting it under a module's scope
   switcher would advertise a scoping it does not have. Settings keeps
   Appearance / Workspace / Providers; the split is "app config" versus "what
   this workspace's agent can do".

2. **One module, two sub-tabs — not two modules.** Both sub-tabs answer the same
   question, both are scoped, and both use the same review idiom, so the shell
   chrome (scope switcher, refresh) is written once rather than twice. It also
   keeps the `+` menu at four entries.

3. **Named "Library", not "Extensions".** Registry key `library`. Naming the
   module after one of its two sub-tabs makes the pair impossible to talk about
   ("the Extensions tab in Extensions").

4. **The module owns its scope; the scope store does not.** `Library.svelte`
   derives scope from its `workspaceId` prop plus a local `showRoot` toggle,
   exactly as `Kanban.svelte` does, and the toggle is hidden when the workspace
   _is_ root. The modal could use one global `editing.scope` because only one
   modal exists; two Library tabs in two workspaces would fight over it.

5. **Sections live in their feature directories, not in `library/`.**
   `extensions/Extensions.svelte` sits beside `extensions/bindings.ts`;
   `prompts/Prompts.svelte` beside `prompts/bindings.ts` — matching
   `kanban/Kanban.svelte` and `chat/Chat.svelte`. `library/` holds only the
   shell.

6. **An explicit Refresh control.** A module tab stays mounted (`Column.svelte`
   hides inactive tabs with a class), so the implicit "re-list on every modal
   open" disappears with the modal. Without a replacement, an extension an agent
   writes mid-conversation would never appear in Awaiting review. Refresh on
   mount, on scope switch, after every mutation, and on demand. Plumbing a "tab
   became active" signal down from `Column` is the alternative and is more
   machinery than the problem needs.

7. **`+` menu only.** No stub left behind in Settings pointing at the new
   module.

8. **Behaviour is carried over unchanged.** Same bindings, same states, same
   copy, same review-before-enable gate. This is a relocation; changing what the
   sections do at the same time would make a regression indistinguishable from
   an intended change.

## Architecture

### Modules

| File                                    | Change | Responsibility                                                                                                                             |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/library/Library.svelte`        | New    | Shell: sub-tab state, scope derivation and root/workspace toggle, refresh trigger                                                          |
| `src/lib/extensions/Extensions.svelte`  | New    | The Extensions section, lifted from the modal; props `{ scope, inRoot, refreshKey }`                                                       |
| `src/lib/prompts/Prompts.svelte`        | New    | The Prompts section, lifted from the modal; props `{ scope, inRoot, refreshKey }`                                                          |
| `src/lib/modules/registry.ts`           | Modify | Register `library`                                                                                                                         |
| `src/lib/layout.ts`                     | Modify | No change needed to `LABELS` — `moduleLabel("library")` already yields "Library"; pinned by a test                                         |
| `src/lib/settings/SettingsModal.svelte` | Modify | Drop both sections, the scope-selector strip, `SCOPED_SECTIONS`, and the now-unused `editing`/`editScope`/`ROOT`/`activeWorkspace` imports |
| `src/lib/scope/store.ts`                | Modify | Remove `editing` and `editScope`, and the `editing.update` tail of `patchScopeChat` that existed only to keep the modal in sync            |
| `src/lib/extensions/agent-tools.ts`     | Modify | "Settings → Extensions" → the Library module                                                                                               |
| `src/lib/prompts/agent-tools.ts`        | Modify | "Settings → Prompts" → the Library module                                                                                                  |
| `src/lib/layout_test.ts`                | Modify | Pin `moduleLabel("library")`                                                                                                               |

`TabStrip.svelte` needs no change: it offers every registry key except `chat`
and `filetree`, so `library` appears in the `+` menu by being registered.

### The shell

```
┌───────────────────────────────────────────────┐
│ [Extensions] [Prompts]      [Root|WS-2]  ↻    │  ← sub-tabs, scope, refresh
├───────────────────────────────────────────────┤
│                                               │
│   <Extensions scope={…} inRoot={…} />         │
│                                               │
└───────────────────────────────────────────────┘
```

```svelte
let { workspaceId }: { title: string; workspaceId?: string; … } = $props();

const inRoot = $derived(workspaceId === ROOT);
let showRoot = $state(false);
const scope = $derived(inRoot || showRoot ? ROOT : workspaceId);
let tab = $state<"extensions" | "prompts">("extensions");
let refreshKey = $state(0);
```

The scope toggle is hidden when `inRoot` — root has no other scope to switch to,
and a workspace can never configure a sibling. This is the same constraint the
modal's `scopes` array encoded, expressed the way Kanban already expresses it.

`refreshKey` is a counter the sections take as a prop and re-list on, so the
shell can drive a refresh without reaching into either section's state. Each
section also re-lists when `scope` changes.

### What Settings becomes

`SECTIONS` drops to Appearance / Workspace / Providers. With no scoped section
left, the scope-selector strip, `SCOPED_SECTIONS`, and the four scope-related
imports go too. `SettingsModal.svelte` falls from ~1080 lines to roughly 350.

`editing` and `editScope` in `scope/store.ts` have no other callers, so they go
with the modal's use of them. `patchScopeChat` stays — `chat/store.ts` calls it
when a user picks a model — minus its trailing `editing.update`, which existed
only to keep the modal's copy in sync and now syncs nothing.

`updateScopeConfig` goes too. It was **already unused** before this change — so
it is not an orphan this work created — but it is built entirely out of
`editing` (`get(editing)`, `editing.set`), so it cannot survive the writable's
removal. That strips the last uses of the `get`, `writable` and `ROOT` imports
in the file, which go with it, leaving `patchScopeChat` as the only export.

### Text that names the old location

Agent-facing (strings the agent repeats to the user, so they go stale on
landing):

- `extensions/agent-tools.ts` — the `define_extension` description and its
  success message.
- `prompts/agent-tools.ts` — the `define_prompt` description and its success
  message.

No test asserts these strings, so the change is source-only.

Human-facing docs:

- `docs/prompts.md` — four references to Settings → Prompts.
- `docs/scopes.md` — one, in the extensions section.
- `docs/extensions.md` — the three that mean pique's UI. The file's many other
  "Settings" mentions are pi's own `SettingsManager` (`addSourceToSettings`,
  `setPackages`) and **must not** be swept up in a find-and-replace.
- `docs/agent-verification.md` — the web-mode checklist, which currently names
  the settings modal as the thing worth testing there.

## Verification

The repo has no Svelte component tests; coverage is at the service and binding
level and the UI is verified manually per
[agent-verification.md](../../agent-verification.md). This work does not change
that.

- **Unchanged and must stay green:** every `extensions/*_test.ts` and
  `prompts/*_test.ts`. Nothing below the UI moves, so a failure here means
  something was moved that should not have been.
- **`layout_test.ts`:** `moduleLabel("library")` is "Library", and
  `addTab(v, "library")` appends a tab titled "Library".
- **`deno task test`** and **`deno fmt`** over the whole tree — the settings
  modal's deletions and the scope-store removals are exactly the kind of change
  that leaves a dangling import. (`deno lint` reports 30 pre-existing problems
  and is not a gate; the count must not grow.)
- **Manual, web mode** (`preview_start {name: "web"}`): Library appears in the
  `+` menu; opening it gives a tab titled "Library"; sub-tabs switch; both
  sections show the desktop-only placeholder, as Terminal and Chat do. Settings
  still opens on `ctrl+,` with three sections and no scope strip.
- **Manual, desktop** (`deno task dev`) — the only surface where the lists have
  data: an extension enables and a template saves from the module, the scope
  toggle switches between root and workspace lists, and Refresh picks up a
  template written by an agent while the tab stayed open.

## Deferred

1. **Providers as a module.** Left in Settings by decision 1. If profiles or
   model defaults later grow their own scoped surface, the split is worth
   revisiting as a whole rather than moving Providers alone.
2. **Refresh without a button.** A "tab became active" signal from `Column`
   would make decision 6's control unnecessary, and would benefit any module
   that lists filesystem state. Out of scope here.
3. **A real prompt editor.** The module has far more room than the modal did,
   but the textarea is carried over as-is per decision 8.
4. **Live reload into running sessions.** Unchanged: enabling an extension still
   only affects Chat modules opened afterwards.
   [extensions.md](../../extensions.md) deferred #5.
5. **Stale-response guards on the section lists.** `refreshExts()` and
   `refreshPrompts()` are fired and not awaited, so two fast scope switches can
   land out of order and leave the previous scope's list on screen; the same
   applies to the success notice `extAction` writes after its mutation. This is
   pre-existing behaviour carried over under decision 8, but the module makes it
   more reachable — the modal's scope strip was behind a modal open, while the
   shell's toggle is one click in an always-visible toolbar. The next Refresh
   corrects it. Fix is a captured-scope comparison before each assignment.
6. **The review-to-enable window is now unbounded.** `reviewing` / `reviewed`
   clear only on scope change, refresh, or a mutation, so a Library tab left
   open all day lets a user review code in the morning and press Enable in the
   afternoon on a file an agent rewrote in between. The mechanism is unchanged —
   the modal never unmounted either (`App.svelte:212` renders it
   unconditionally) — but a persistent tab invites the pattern in a way a modal
   did not. Re-reading on Enable is more machinery than decision 8 permits here.
