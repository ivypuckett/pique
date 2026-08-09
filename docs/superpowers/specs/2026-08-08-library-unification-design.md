# Library Unification — Design

**Date:** 2026-08-08 **Status:** Designed

## Purpose

Collapse the Library module's three sub-tabs — Extensions, Prompts, Skills —
into one surface, grouped by what needs your attention rather than by what kind
of thing it is.

The [module's original design](2026-08-03-library-module-design.md) argued that
Extensions and Prompts belonged together because both are scoped, both are
list-heavy, and both use the same review idiom. Skills joined later on the same
logic. That argument was right, and the sub-tabs are where it stopped short:
three tabs that share a shape, a prop signature, a refresh trigger and a scope
switcher, each rendering its own copy of Awaiting review → yours → inherited.
The consequence is that the review gate — the one thing in this module that is
time-sensitive — is split across three places, and a pending prompt is invisible
while you are looking at extensions.

The catalog search compounds it. It lives at the bottom of the Extensions
sub-tab, but it searches npm for **pi packages**, and a pi package can ship
extensions, prompts and skills; `Extensions.svelte` already has to say "this
package ships skills or prompts only" when it resolves no entry files. The one
install path for all three kinds is filed under one of them.

## Scope

**In:**

- One list in `Library.svelte`, grouped Awaiting review / Active / Inherited
  from Root, with the kind as a per-row badge.
- A `LibraryItem` model and four pure mapping modules that produce it.
- Per-kind detail views, extracted from the sections they live in today.
- One Add bar: catalog search, plus buttons for a new prompt and a manual
  source.
- Unified action verbs across kinds.
- Retargeting the ~25 sites that name a sub-tab by address.

**Out:** any change to a service, a binding, a `desktop.ts` handler, or an
on-disk layout; any change to the review gate's semantics; a filter box over the
installed list (see [decision 2](#decisions)); Providers, which stays in
Settings for the reasons the original design gave.

## Decisions

1. **Group by state, badge the kind.** Awaiting review first, then Active, then
   Inherited from Root. The alternative — the three sub-tabs stacked vertically
   as headed sections — is a smaller change but reproduces the problem: three
   "Awaiting review" headings down one page. Grouping by state is the entire
   reason to unify rather than merely to stack.

2. **No filter box.** Searching means the catalog, not the installed list. A
   scope's library is small enough to scroll, and a filter that hides a pending
   item would work directly against decision 1. Reconsider if a real library
   ever gets long enough to need it.

3. **The catalog moves to the top and stops being an Extensions feature.** It
   searches pi packages, which is the install path for all three kinds. Leaving
   it under Extensions was accurate about the common case and wrong about the
   contract.

4. **One component with kind branches, not an adapter interface.**
   `Library.svelte` owns the model, the fetch, the groups and the row chrome,
   and switches on `item.kind` for actions and detail. An adapter interface over
   exactly three known kinds is an abstraction for single-use code (CLAUDE.md
   §2), and it would not even pay for itself: the three detail views are
   genuinely different, so an adapter would end up returning Svelte snippets —
   indirection with nothing behind it.

5. **The split is Svelte-versus-TS, not shell-versus-kind.** The original
   design's decision 5 put each section next to its bindings, and that is worth
   keeping, but it is not a reason to keep three list renderers. So: the
   **mapping** for each kind is a pure TS module in that kind's directory
   (`extensions/items.ts` and so on), and the **detail view** for each kind is a
   component in that kind's directory. Only the list itself is centralized. This
   also puts every piece of logic in a `deno test`-able module — the repo has no
   Svelte component tests, so anything left in a `.svelte` file is untested by
   construction, and the mappers are exactly the part worth testing.

6. **Verbs unify; bindings do not.** Under one "Awaiting review" heading, an
   extension saying _Enable_ beside a prompt saying _Approve_ reads as two
   different acts when it is one. Both become **Enable** / **Delete**. The
   `promptsApprove` and `promptsReject` bindings keep their names — they are
   accurate about the files they move, and renaming them would touch the backend
   this design otherwise leaves alone.

7. **Skills land in Active with no actions.** They have nothing to enable and
   nothing to revoke. Listing them beside things that do makes visible what the
   read-only Skills tab never quite said: a skill in scope is already in effect.

8. **This is a view-layer change only.** No service, binding or handler is
   touched. As with the original move, a behaviour change landing at the same
   time as a structural one makes a regression indistinguishable from an
   intended change — with one deliberate exception, in decision 9.

9. **The stale-scope guard is applied uniformly.** Merging three fetches into
   one means writing the guard once, and `Skills.svelte` does not have it today
   (its `$effect` assigns whatever resolves). Keeping the gap deliberately, in
   the one place where the code is being rewritten anyway, is worse than closing
   it. This closes deferred item #5 of the original design.

## Architecture

### The item model

`src/lib/library/items.ts` holds the type and the grouping, and nothing else:

```ts
export type LibraryState = "pending" | "active" | "inherited";

type Common = {
  // `${kind}/${scope}/${identifier}` — the extension's `id`, the prompt's `name`, the
  // skill's `path`. Unique across kinds AND scopes, which is what the expanded-row state
  // keys on: the same name can exist in root and in a workspace, and expanding one must
  // not expand the other.
  key: string;
  scope: ScopeId;
  state: LibraryState;
  title: string;
  subtitle?: string;
  badge?: string;
  // Two severities, because the existing UI has two: `problem` is red (a template or a
  // skill whose frontmatter would not parse), `note` is dim (a skill whose frontmatter
  // `name:` disagrees with the basename an automaton must use). Collapsing them would
  // either shout about a naming quirk or whisper about a broken file.
  problem?: string;
  note?: string;
};

export type LibraryItem =
  | (Common & { kind: "extension"; ext: Extension })
  | (Common & { kind: "prompt"; prompt: PromptInfo })
  | (Common & { kind: "skill"; skill: SkillInfo });
```

A discriminated union rather than a common record with a `source: A | B | C`
field: the shell's branches narrow to the right payload, so `item.ext.origin` is
a type error inside the prompt branch.

`badge` carries an extension's `origin` and a prompt's `shadowed` marker. None
of these is a kind — a row already shows its kind as its own badge — so none
needs a field of its own.

### Mapping, per kind, in that kind's directory

| Module                | Input                                     | State rule                                                                             |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `extensions/items.ts` | `extensionsVisible(scope)`                | `e.scope !== scope` → inherited; else `pending` → pending, `enabled` → active          |
| `prompts/items.ts`    | `promptsList(scope)`, `promptsList(ROOT)` | own `pending` → pending; own `live` → active; root's `live` → inherited (scope ≠ root) |
| `skills/items.ts`     | `skillsVisible(scope)`                    | `s.scope === scope` → active; else inherited                                           |

Each exports one pure function from its binding's response to `LibraryItem[]`.
The prompt mapper is the only one taking two lists, because prompts are the only
kind whose inherited set comes from a second call rather than from the visible
one — an asymmetry in the existing bindings that this design does not disturb.

`library/items.ts` then groups by `state` and sorts within a group by kind
(extension, prompt, skill) then title. Sorting is deterministic so it can be
pinned by a test; kind-first keeps a row's neighbours stable as items come and
go.

### One fetch

`Library.svelte` runs a single `refresh()`:

```ts
const forScope = scope;
const [exts, failures, own, rootPrompts, skills] = await Promise.all([...]);
if (forScope !== scope) return;   // a switch landed while this was in flight
```

Five calls, all of them the ones the sections make today: `extensionsVisible`,
`extensionsLoadErrors`, `promptsList(scope)`, `promptsList(ROOT)` when the scope
is not root, and `skillsVisible`. One `$effect` on `scope` and `refreshKey`
drives it, as all three sections' effects do now.

`scopeIsRoot` is captured alongside `forScope`, not re-read after the await:
reading the prop again would mix one scope's list with the other's answer to
"does this scope inherit". `Prompts.svelte` already does this and the comment
explaining why carries over.

### One action path

`act(run, notice)` merges `extAction` and `promptAction` — run, clear the
expanded row, re-list, report — and calls `refreshChatCommands()` after any
prompt mutation, since every one of them changes what `/` offers. One `busy`,
one `notice`, one `error`, rendered once at the bottom instead of twice.

### Rows

The collapsed row is uniform across kinds: kind badge, title, subtitle, buttons.
Buttons by state:

| State     | Extension                | Prompt                   | Skill |
| --------- | ------------------------ | ------------------------ | ----- |
| pending   | Review · Enable · Delete | Review · Enable · Delete | —     |
| active    | View · Revoke · Delete   | View · Edit · Delete     | View  |
| inherited | View                     | View                     | View  |

Enable stays disabled until the row is expanded, for both kinds. Approving
without looking is the failure the gate exists to prevent, and that is as true
of a prompt whose text becomes your message as of code that executes.

**Delete is one label over two prompt bindings**: `promptsReject` for a pending
template, `promptsDelete` for a live one. Both remove the file; the backend
keeps them separate because the directories differ, and the row already knows
its state. Extensions have one `extensionsRemove` taking the state as an
argument, so no branch is needed there.

Expanding renders a detail component from the kind's own directory:

| Component                           | From                                           |
| ----------------------------------- | ---------------------------------------------- |
| `extensions/ExtensionReview.svelte` | today's `reviewPane` snippet, unchanged        |
| `prompts/PromptDetail.svelte`       | today's read-only body and rationale block     |
| `skills/SkillDetail.svelte`         | today's path, description and frontmatter note |

`prompts/PromptEditor.svelte` — today's draft form — is **not** a row detail. It
opens beneath the Add bar, whether reached by `New` or by `Edit` on an active
row, because a create and an edit are the same form and a form nested inside a
list row is the more awkward of the two placements. The
draft-belongs-to-its-scope effect carries over: a scope switch discards it, a
Refresh must not.

The shell owns the read that feeds `ExtensionReview`. Expanding an extension row
calls `extensionsRead` and holds the returned `ExtensionSource`, exactly as
`toggleReview` does today; the component is presentation only, so the digest the
shell hands to `extensionsEnable` is the one it read itself.

The extension review keeps its `expectDigest` handshake exactly as it is: what
you read is what gets enabled, and the backend refuses if the bytes moved in
between. That guard is the reason the review gate means anything, and it is
untouched here.

The load-error panel keeps its own block above the groups rather than becoming
row state. A failure names a file inside an install tree, not the source string
a row shows, so attributing one to a row would silently miss — the reasoning in
`Extensions.svelte` is unchanged by unification.

### The Add bar

```
┌──────────────────────────────────────────────────────────┐
│ [Search the pi catalog…  ] [Search]  [New prompt] [Add…] │
├──────────────────────────────────────────────────────────┤
│ (catalog results, when any)                              │
│ (prompt editor or source input, when opened by New)      │
├──────────────────────────────────────────────────────────┤
│ AWAITING REVIEW                                          │
│  [ext]    my-linter        Review  Enable  Delete        │
│  [prompt] /triage          Review  Enable  Delete        │
│ ACTIVE                                                   │
│  [ext]    npm:@pi/git      View  Revoke  Delete          │
│  [skill]  brainstorming    View                          │
│ INHERITED FROM ROOT                                      │
│  [skill]  dataviz          View                          │
└──────────────────────────────────────────────────────────┘
```

**New prompt** opens the editor beneath the bar; **Add source…** reveals the
`npm:` / `git:` input. Two plain buttons rather than one `New ▾` menu: this
codebase has no dropdown anywhere — every menu is a flat button row or a `menu`
list — and a two-item dropdown would be a new interaction idiom bought for
nothing. Adding from either the catalog or the source input routes through the
existing `confirming` gate and its warning: fetching an npm package runs its
install scripts, which happens before any review is possible.

Skills have no `New` entry because there is nothing for the app to write — a
skill is a file you put in `agent/skills/`. That instruction becomes a one-line
footer, where it is true of the module rather than of a tab.

The header row above the Add bar keeps the scope toggle and Refresh unchanged.
The sub-tab buttons and `section` state go.

### Files

| File                                | Change  |
| ----------------------------------- | ------- |
| `library/items.ts`                  | New     |
| `library/Library.svelte`            | Rewrite |
| `extensions/items.ts`               | New     |
| `extensions/ExtensionReview.svelte` | New     |
| `prompts/items.ts`                  | New     |
| `prompts/PromptDetail.svelte`       | New     |
| `prompts/PromptEditor.svelte`       | New     |
| `skills/items.ts`                   | New     |
| `skills/SkillDetail.svelte`         | New     |
| `extensions/Extensions.svelte`      | Delete  |
| `prompts/Prompts.svelte`            | Delete  |
| `skills/Skills.svelte`              | Delete  |

Roughly 850 lines of Svelte become roughly 350 in the shell plus four extracted
components and four mappers.

### Text that names a sub-tab

`Library → Extensions`, `Library → Prompts` and `Library → Skills` all become
**the Library module** — the form the original design reserved for prose about
the module as a whole. The addresses are dead once the sub-tabs are, and two of
these categories are read by someone other than the author of the change:

- **Agent-facing**, repeated back to users: `extensions/agent-tools.ts` (three
  sites), `prompts/agent-tools.ts` (three).
- **User-facing at runtime**: `automatons/resolve.ts:147,184` — the "enable it
  in Library → Extensions" errors an automaton raises when it names an extension
  that is not enabled.
- **Docs**: `extensions.md`, `prompts.md`, `scopes.md`, `automatons.md`,
  `agent-verification.md` (whose checklist names the sub-tabs directly).
- **Comments**: `desktop.ts`, `chat/agent.ts`, `chat/store.ts`,
  `prompts/parse.ts`, `prompts/service.ts`, `extensions/packages.ts`, and three
  test files.

The agent-tool strings are concatenated at runtime — re-read each end to end
after editing, because the join points move.

Must **not** be swept up: pi's own `SettingsManager` mentions throughout
`extensions.md`, and `chat/providers.ts`, which is about Settings and always
was.

## Verification

- **`deno test`** — new `items_test.ts` beside each mapper and one for
  `library/items.ts`: an inherited extension, a shadowed prompt, a prompt
  pending in a workspace while root has a live one of the same name, a skill
  whose scope differs, group order, sort order within a group, and every kind
  empty. These hold the logic precisely because a `.svelte` file cannot be
  tested here.
- **Untouched and must stay green:** every existing `extensions/*_test.ts`,
  `prompts/*_test.ts` and `skills/*_test.ts`. Nothing below the view moves, so a
  failure there means something moved that should not have.
- **`deno fmt`** over the tree. `deno lint`'s pre-existing problem count must
  not grow.
- **Manual, web mode** (`preview_start {name: "web"}`): the Library tab shows
  the desktop-only note, with no sub-tab strip.
- **Manual, desktop** (`deno task dev`) — the only surface with data:
  1. A pending extension and a pending prompt appear together under Awaiting
     review. Enable is disabled on both until expanded.
  2. Enabling the extension moves it to Active; `/reload` in a Chat module picks
     it up.
  3. Enabling the prompt moves it to Active and `/name` works in an open chat
     without a restart.
  4. Editing an active prompt round-trips; Delete removes it.
  5. Skills appear in Active, action-less, and root's appear under Inherited.
  6. The scope toggle switches every group at once; switching mid-fetch does not
     leave the previous scope's rows on screen.
  7. Catalog search returns results; Add shows the download warning and lands
     the package in Awaiting review, not in Active.
  8. Refresh picks up a template an agent wrote while the tab stayed open.

## Deferred

1. **A filter box.** Decision 2. Revisit if a library grows past a screen or
   two.
2. **Refresh without a button.** Still open from the original design: a "tab
   became active" signal from `Column` would remove the need for the control.
   Unification makes it cheaper to adopt later — there is one refresh path now
   instead of three.
3. **Kind-aware catalog results.** A package's search result does not say
   whether it ships extensions, prompts or skills, so the results group cannot
   badge them the way the installed groups do. npm's search response does not
   carry it; finding out means fetching the package.
4. **The unbounded review window.** Unchanged from the original design: a tab
   left open all day still lets you review in the morning and Enable in the
   afternoon. The `expectDigest` handshake means an extension rewritten in
   between is refused rather than silently enabled; prompts have no equivalent.
5. **Live reload into running sessions.** Unchanged. Enabling an extension still
   only reaches Chat modules opened afterwards, or one where you type `/reload`.
