# Scopes

How pique decides what a chat agent can see: its tools, its model defaults, its
working directory, and its Kanban board. And — at the end — what this first
version deliberately does not do.

## The tree

There is one **root workspace** and any number of numbered workspaces. Root is a
workspace like any other on screen: it has views, modules, and its own board. It
is also every other workspace's parent.

```
root          ← shared: what every workspace inherits
├── ws-1      ← its own tools/prefs/board, PLUS root's
├── ws-2
└── ws-3
```

Inheritance runs one way only. `ws-1` can see root; root cannot see `ws-1`;
`ws-1` cannot see `ws-2`. The whole rule is one function, `chain` in
`scope/paths.ts`:

```ts
chain("root")  → ["root"]
chain("ws-1")  → ["root", "ws-1"]   // ancestors first, so the nearest scope wins
```

That is the only place the hierarchy's shape is encoded. If scopes ever nest
deeper than two levels, widening `chain` is most of the work.

Root cannot be closed, so `SessionState.workspaces` may be empty — closing the
last numbered workspace falls back to root rather than resurrecting a blank one.

## On disk

Each scope owns one directory:

```
~/.pique/scopes/<root|ws-N>/
  config.json    chat defaults
  agent/         this scope's pi agentDir
    extensions/  enabled local extensions — pi auto-discovers these
    pending/     awaiting review — pi never loads these (`.ts` modules, `.json` packages)
    prompts/     live prompt templates — pi auto-discovers these too
      pending/   agent-written, awaiting review — pi's scan does not recurse
    skills/      nameable skills — pi's own location, listed but not gated
    settings.json  enabled pi packages
  automatons/    launchable definitions (see automatons.md)
    pending/     reserved for define_automaton; nothing writes here yet
    runs/        one JSON record per run
    sessions/    each run's transcript, as pi session JSONL
  sessions/      saved chat conversations, as pi session JSONL
    view-N/      one directory per view — each view holds its own conversation
  board.db       this scope's Kanban board
```

`automatons/` sits outside `agent/` for the reason `sessions/` does: pi
auto-discovers inside an `agentDir`, and a directory of markdown there invites
it to interpret files that are pique's, not pi's. `agent/skills/` is inside for
the opposite reason — pi's discovery there is exactly what is wanted.

`sessions/` sits beside `agent/` rather than inside it so pi does not also find
these under its own default session path. A chat resumes the newest session
recorded for its working directory, which is what makes a conversation survive
closing pique; "New chat" starts another and leaves the old file in place.

The conversation belongs to the **view**, not the workspace: two views side by
side are two threads, and only the scope around them — tools, model defaults,
board, cwd — is shared. pi's `continueRecent` scans one flat directory, so
keeping the threads apart means keeping the directories apart, one per view id
(`scopeViewSessionsDir`). View ids are reused when a view is closed and another
opened, exactly as workspace ids are, so a new `view-2` resumes what the last
`view-2` was saying.

Anything genuinely app-wide stays in `~/.pique/settings.json` (theme, git scan
depth). The layout tree stays in `~/.pique/layout.json`, which is also where
each workspace's `cwd` lives.

An install predating all this is folded into `scopes/root/` once, at startup, by
`scope/migrate.ts` — the old global `agent/` dir becomes root's, each
`boards/ws-N.db` moves to its workspace, and the scoped sections of
`settings.json` become root's `config.json`. It is guarded by the existence of
`~/.pique/scopes`, so it runs at most once, and it renames rather than copies,
because the old paths were the only copy of the user's boards.

## How each thing inherits

|                      | Mechanism                                    | Merge rule                                            |
| -------------------- | -------------------------------------------- | ----------------------------------------------------- |
| **Tools**            | `agentDir` + `additionalExtensionPaths`      | union — root's tools plus its own                     |
| **Base prompt**      | `scope/prompt.ts:resolveBasePrompt`          | nearest `SYSTEM.md` wins, whole file                  |
| **Prompt appendix**  | `scope/prompt.ts:resolveAppendPrompts`       | every `APPEND_SYSTEM.md` concatenates, root's first   |
| **Prompt templates** | `agentDir` + `additionalPromptTemplatePaths` | union, nearest name wins                              |
| **Skills**           | `skills/service.ts:listVisibleSkills`        | union, nearest name wins                              |
| **Automatons**       | `automatons/service.ts:resolveAutomaton`     | union, nearest name wins                              |
| **Packages**         | `agentDir` + `additionalExtensionPaths`      | union — resolved to entry files first                 |
| **Chat defaults**    | `resolveScopeConfig`                         | per key — override one field, inherit the rest        |
| **cwd**              | `resolveModuleDir`                           | workspace's, else root's, else `$HOME`                |
| **Kanban board**     | explicit `scope` argument                    | no merge — two boards, one addressable from the other |

### Tools

pi discovers extensions from exactly **one** `agentDir`, so inheritance is
assembled in `chat/agent.ts:startAgent` rather than by pi:

- `agentDir` is the scope's own dir — its approved tools and its installed
  packages.
- `additionalExtensionPaths` is every extension inherited from an ancestor,
  reduced to explicit file paths by
  `extensions/service.ts:inheritedExtensionPaths` — an ancestor's local modules
  directly, and its enabled packages by resolving each source to the entry files
  pi would run.

Two things about this are easy to get wrong and silent when you do:

1. **`additionalExtensionPaths` takes files, not directories.** Passing a
   directory fails with `Cannot find module` and the inherited tools simply
   never load.
2. **A `resourceLoader` you construct yourself must be `reload()`ed by hand.**
   `createAgentSession` only reloads a loader it created itself, so skipping
   this yields an agent with no extensions at all.

Both are verified by `chat/scope_integration_test.ts`, which drives the real
`startAgent` and asserts on `getActiveToolNames()`.

### The base prompt

A scope's optional base prompt is its `agent/SYSTEM.md`, replacing pi's own
preamble for every agent that runs there. That is pi's own filename, but pi only
ever discovers the single `agentDir` it was handed — so root's would be
invisible to a workspace. `scope/prompt.ts:resolveBasePrompt` walks the chain
nearest-first and passes the winner to pi explicitly, which is what makes it
inherit at all. No `SYSTEM.md` anywhere on the chain resolves to `undefined`,
not `""`, because that is what leaves pi's preamble in place.

See [prompts.md](prompts.md) for why steering a single task is a template
instead: nothing here is selectable per conversation.

### The prompt appendix

A scope's optional `agent/APPEND_SYSTEM.md` is added **on top of** whatever the
base turned out to be — pi's own preamble included. Also pi's own filename, also
invisible across scopes for the same one-`agentDir` reason, so
`scope/prompt.ts:resolveAppendPrompts` walks the chain and `chat/agent.ts` hands
pi the whole list through `appendSystemPromptOverride`.

It merges by the **opposite rule to `SYSTEM.md`**, and that is the whole reason
it is a second file rather than a second way of writing the first:

- `SYSTEM.md` is **nearest-wins**. Two of them cannot both be "the" preamble, so
  a workspace's shadows root's and only one ever applies.
- `APPEND_SYSTEM.md` **concatenates, root's first**. Root holds house rules,
  each workspace adds its archetype, and both apply.

That is what lets one workspace hold Swift guidance and another hold Go guidance
without either seeing the other's, while a single set of house rules covers
both. Neither workspace has to restate the house rules, and neither can leak its
archetype sideways — `chain()` gives a workspace root and itself, never a
sibling.

The appendix is also the one that works with **no `SYSTEM.md` anywhere**: pi
applies the append section in both branches of `buildSystemPrompt`, so house
rules land on top of pi's preamble rather than requiring you to replace it
first. That matters given decision 2 — pique specifies no system prompt of its
own, and the appendix lets a user steer without giving that up.

Two things to know about handing this to pi:

1. **The array is always passed, empty included.** Given nothing, pi falls back
   to discovering the single `agentDir`'s own `APPEND_SYSTEM.md` — which
   `resolveAppendPrompts` already includes as its last entry, so omitting it
   would duplicate the workspace's own file.
2. **pi joins the entries with a blank line**, so a whitespace-only file would
   contribute blank lines rather than nothing. `resolveAppendPrompts` drops
   those, and `savePromptFile` deletes rather than writing one.

`chat/base_prompt_integration_test.ts` drives the real `startAgent` for both
files: the two-workspace case, the ordering, and both reaching a running
conversation on `/reload`.

### Editing either of them

Both appear in the **Library** as their own row kinds, `system` and `appendix`
(`scope/prompt-items.ts`), listed in every scope whether or not the file exists
— they are singletons with fixed names, so there is nothing to enumerate and a
row is the only place the UI can say the file _could_ exist here. Root's are
listed as inherited only when they do exist.

Saving an empty body **deletes** the file. Absence is what falls back down the
chain; an empty workspace `SYSTEM.md` would shadow root's and then resolve to
`""`, which no row could truthfully describe.

Unlike prompt templates, there is no quarantine and no approve/reject pair: no
agent tool writes these, so the human half is the only half.

### Prompt templates

Templates — see [prompts.md](prompts.md) — inherit the same way local extensions
do, but the option that carries them, `additionalPromptTemplatePaths`, takes
**directories**, so ancestors' whole `prompts/` dirs are handed over rather than
globbed into files. Note that this is the opposite of the extension gotcha
above; the two options do not agree, and nothing warns you.

pi collapses a name collision itself, first path wins. The scope's own
`agentDir` is searched before the extra paths, so a local template shadows
root's.

### The Kanban board

Boards are **not** merged. Merging two SQLite boards means reconciling status
columns and colliding card ids, which buys little here. Instead each Kanban tool
and binding takes a `scope` argument: `"own"` (default) is the workspace's
board, `"root"` is the shared one. A root agent has only its own board, so the
parameter is inert there. The Kanban module shows the same choice as a
two-button switcher.

This preserves the visibility rule exactly — a workspace can name root's board,
and nothing can name a workspace's board from outside it.

A board owns its own columns. Every new board is seeded with the same four —
Backlog, Todo, In Progress, Done (`kanban/service.ts`) — and from then on the
columns are added, renamed, reordered and deleted on the board itself. There is
no config for this: a seed list was configurable per scope once, but it only
affected boards that did not exist yet, so editing it did nothing visible to
anyone who already had a board. Those edits take the same `scope` argument as
every other Kanban call, so a workspace can restructure the shared root board
and nothing can reach a workspace's board from outside it.

Two refusals keep the data honest: a column that still holds cards cannot be
deleted (move them first — an implicit move would need a `set_status` reason
nobody supplied), and the last remaining column cannot be deleted (a board with
zero columns would be silently re-seeded from the defaults on next open). Column
edits are not written to the card log, which is card-scoped by schema.

### Automatons and their runs

Definitions inherit like prompt templates: root's are launchable from every
workspace, and a same-named local one shadows root's. Two things belong to the
**launching** scope regardless of where the definition came from — the run and
its record under `automatons/runs/`, and everything the run resolves against,
which means the model, the base prompt, the Kanban board and the working
directory. (The model only when the definition does not pin one of its own — see
[automatons.md](automatons.md).) A root automaton launched in `ws-1` is
therefore `ws-1`'s run, touching `ws-1`'s board.

This is also where the package rule above bites. Because packages are not
inherited, a root automaton naming one only launches from a scope where that
package is enabled; anywhere else the reference resolves to nothing and the
launch is refused. Local extensions and skills do not have this problem, since
both inherit. See [automatons.md](automatons.md).

## The review gate, per scope

Extensions work the way [extensions.md](extensions.md) describes: nothing runs
until it is in pi's own loading set for the scope, and an agent's
`define_extension` can only write into `pending/`. What scoping adds is reach:

- An agent in `ws-1` quarantines into `ws-1`, and enabling grants it to `ws-1`
  alone.
- An agent in **root** quarantines into root, and enabling grants it to
  **every** workspace. `define_extension`'s description says so explicitly, so
  the agent knows how far its code will reach.

The Library module shows a scope's own extensions (enablable, revocable)
separately from the ones it inherits (read-only — they are managed where they
live).

---

## Deferred

### 1. Inheriting installed packages — built

A workspace agent now gets root's enabled npm packages as well as its local
`.ts` modules. The deferral was about risk that no longer exists: routing root's
package sources through `additionalExtensionPaths` is dynamic `import()` of an
npm package with `agentDir` set, which a 2026-07-21 bisect blamed for a
`RefCell already borrowed` panic in deno_core — an upstream bug fixed in Deno
2.9.4 ([extensions.md](extensions.md) Known broken #5). Exercised now rather
than assumed: `chat/scope_integration_test.ts` drives a real local-path package
enabled in root through to a workspace agent's active tool list, and pins that
it reaches neither root's own agent nor a sibling workspace.

### 2. Live reload into running sessions

Approving, revoking and installing now reach a running chat when someone types
`/reload` in it — explicitly, never automatically
([extensions.md](extensions.md) Deferred #2). A **model default** is the part
that does not: it is resolved in `startAgent` at session creation, and reload
does not re-resolve it, so picking a different default for a scope still only
affects Chat modules opened afterwards.

### 3. Deeper nesting

`chain` returns at most two entries. Sub-workspaces, or a scope that inherits
from a sibling, would need it to walk a real parent pointer — and
`WorkspaceState` has no parent field today.

### 4. Per-scope providers

Model providers (`auth.json`, `models.json`) are still machine-wide and shared
with the user's `pi` CLI. Only which _model_ is picked by default is per-scope.

### 5. Moving a tool between scopes — built

Every workspace-owned Library row now carries **Promote**, which moves it into
root: extensions, prompt templates, skills and subagents. Not the two prompt
files — `SYSTEM.md` and `APPEND_SYSTEM.md` are singletons whose scopes merge by
opposite rules, so moving one would be a rewrite of root's rather than a move.

Three decisions worth keeping:

- It **moves**, it does not copy. Every kind here resolves nearest-first, so a
  copy left in the workspace would go on shadowing the root one while the two
  drifted — the opposite of what promoting is for.
- An extension lands in root's **quarantine**, whatever state it held in the
  workspace. Enabling in root is what lets code run in every workspace, and that
  is a decision for a fresh review, not one inherited from a review someone did
  once for one workspace. A prompt template, which is inert until invoked, keeps
  the state it had.
- A name root already holds **stops the promote and asks**, rather than
  clobbering: replacing root's copy changes what every workspace inherits,
  including the ones not open. The backend answers `{ conflict: true }` and the
  Library confirms before calling again with `overwrite`.

### 6. Showing inherited values in place

The chat model picker shows the resolved value without indicating whether it
came from root or the workspace. Honest, but less informative than it could be.
