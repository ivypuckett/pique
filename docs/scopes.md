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
    settings.json  enabled pi packages
  sessions/      this scope's saved chat conversations, as pi session JSONL
  board.db       this scope's Kanban board
```

`sessions/` sits beside `agent/` rather than inside it so pi does not also find
these under its own default session path. A chat resumes the newest session
recorded for its working directory, which is what makes a conversation survive
closing pique; "New chat" starts another and leaves the old file in place.

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
| **Prompt templates** | `agentDir` + `additionalPromptTemplatePaths` | union, nearest name wins                              |
| **Packages**         | `agentDir` only                              | **not inherited** (see Deferred #1)                   |
| **Chat defaults**    | `resolveScopeConfig`                         | per key — override one field, inherit the rest        |
| **cwd**              | `resolveModuleDir`                           | workspace's, else root's, else `$HOME`                |
| **Kanban board**     | explicit `scope` argument                    | no merge — two boards, one addressable from the other |

### Tools

pi discovers extensions from exactly **one** `agentDir`, so inheritance is
assembled in `chat/agent.ts:startAgent` rather than by pi:

- `agentDir` is the scope's own dir — its approved tools and its installed
  packages.
- `additionalExtensionPaths` is every tool inherited from an ancestor, globbed
  to explicit file paths by `tools/service.ts:inheritedExtensionFiles`.

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

It is also the only per-scope steering there is: nothing is selectable per
conversation. See [prompts.md](prompts.md) for why steering a single task is a
template instead.

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

## The review gate, per scope

Extensions work the way [extensions.md](extensions.md) describes: nothing runs
until it is in pi's own loading set for the scope, and an agent's
`define_extension` can only write into `pending/`. What scoping adds is reach:

- An agent in `ws-1` quarantines into `ws-1`, and enabling grants it to `ws-1`
  alone.
- An agent in **root** quarantines into root, and enabling grants it to
  **every** workspace. `define_extension`'s description says so explicitly, so
  the agent knows how far its code will reach.

Library → Extensions shows a scope's own extensions (enablable, revocable)
separately from the ones it inherits (read-only — they are managed where they
live).

---

## Deferred

### 1. Inheriting installed packages

A workspace agent gets root's local `.ts` extensions, but not root's installed
npm packages. Wiring that means routing root's package sources through
`additionalExtensionPaths`, which is dynamic `import()` of an npm package while
`agentDir` is set — the exact operation a 2026-07-21 bisect blamed for a
`RefCell already borrowed` panic in deno_core's `ModuleMap` under the desktop
runtime.

That panic was an upstream deno_core bug, fixed in Deno 2.9.4 (see
[extensions.md](extensions.md) Known broken #5), so it is no longer a reason to
defer this. What remains is only that `additionalExtensionPaths` is a
_different_ code path from `settings.json` packages and has never been exercised
here. Packages stay per-scope and un-inherited until someone wires it and tests
it — now an ordinary piece of unbuilt work rather than a blocked one.

### 2. Live reload into running sessions

Unchanged from before: approving, revoking, installing and changing a model
default all take effect in Chat modules opened _afterwards_. A revoked tool
stays live in every running session until it restarts.

### 3. Deeper nesting

`chain` returns at most two entries. Sub-workspaces, or a scope that inherits
from a sibling, would need it to walk a real parent pointer — and
`WorkspaceState` has no parent field today.

### 4. Per-scope providers

Model providers (`auth.json`, `models.json`) are still machine-wide and shared
with the user's `pi` CLI. Only which _model_ is picked by default is per-scope.

### 5. Moving a tool between scopes

There is no "promote to root" action. Sharing a tool a workspace defined means
re-defining it in root, or moving the file by hand.

### 6. Showing inherited values in place

The chat model picker shows the resolved value without indicating whether it
came from root or the workspace. Honest, but less informative than it could be.
