# Kanban Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-workspace Kanban board — statuses as columns, cards you can drag
between them — backed by a SQLite database, with default statuses configured in
Pique Settings, and a set of board operations exposed identically to the human
UI and to the in-process pi chat agent.

**Architecture:** A new `kanban` frontend module (registered in
`modules/registry.ts`) renders columns from a board's statuses and cards. All
mutations flow through one backend module, `src/lib/kanban/board.ts`, which owns
the SQLite connection and every operation. That single module is the "same
function calls" surface: the frontend reaches it via `kanban*` `win.bind`
handlers in `desktop.ts`, and the pi agent reaches it in-process via a pi
extension that registers tools calling `board.ts` directly (no IPC — the chat
agent already runs in the Deno backend). Boards are stored
one-SQLite-DB-per-workspace at `~/.pique/boards/<workspace-id>.db`. Default
statuses live in a new `kanban` section of `~/.pique/settings.json` and seed a
board's `statuses` table on first open.

**Tech Stack:** Deno + `deno desktop` (webview) backend, Svelte 5 (runes),
TypeScript, **`node:sqlite` `DatabaseSync`** (N-API, in-process, zero-build —
see [scope-kanban blocker note](#storage-decision)), `deno test`.

**Storage decision:** A prior spike proved `better-sqlite3` (nan/V8 ABI)
**cannot** load under Deno; Deno's built-in `node:sqlite` (`DatabaseSync`) is
the viable in-process driver. We write our own thin schema here (three tables),
so there is no dependency on scope's data layer at all.

**Conventions:**

- Run tests with `deno task test` (`deno test -A src/`), or one file with
  `deno test -A src/path/to/file_test.ts`.
- `node:sqlite` needs the `--unstable-node-globals`/unstable sqlite flag; add
  `"nodeModulesDir"` is already set — confirm `deno test`/run include
  `--unstable-sqlite` (Task 1 verifies this).
- Svelte `.svelte` components have no unit-test harness in this repo — only
  `.ts` files are unit-tested. Component tasks end in a manual-verification
  note; the final task does the end-to-end check.
- Match the existing module wiring pattern: `<name>/bindings.ts` (frontend
  contract) mirrored by `<name>*` handlers in `desktop.ts`, kept in sync by
  hand.
- Commit after each task.

---

## Data model

Three tables per board DB, matching the requested constraint (`statuses`,
`cards`, `logs`). Relationships that would normally be edge tables are folded
into JSON columns on `cards`, keeping the schema to three tables.

**`statuses`** — the board's columns.

| column     | type    | notes               |
| ---------- | ------- | ------------------- |
| `id`       | TEXT PK | ULID/uuid           |
| `name`     | TEXT    | display name        |
| `position` | INTEGER | left-to-right order |

**`cards`**

| column         | type        | notes                                          |
| -------------- | ----------- | ---------------------------------------------- |
| `id`           | TEXT PK     |                                                |
| `status_id`    | TEXT        | FK → statuses.id                               |
| `position`     | INTEGER     | order within its status column                 |
| `title`        | TEXT        |                                                |
| `description`  | TEXT        |                                                |
| `tags`         | TEXT (JSON) | key→value object (kvp)                         |
| `artifacts`    | TEXT (JSON) | array of external connections (non-card links) |
| `predecessors` | TEXT (JSON) | array of card ids — **canonical** edge store   |
| `parent_id`    | TEXT NULL   | self-ref → cards.id                            |

- **Successors** are the inverse of predecessors and are **derived** on read
  (`SELECT id FROM cards WHERE predecessors LIKE …`, or computed in JS after
  load) rather than stored, so the two directions can't drift. `setConnections`
  edits `predecessors`/`parent_id`; setting a successor on card A is written as
  "A is a predecessor of B".
- **Children** are derived: children of X = cards whose `parent_id = X`.

**`logs`** — append-only audit trail; the status-change reason lands here.

| column    | type             | notes                                                     |
| --------- | ---------------- | --------------------------------------------------------- |
| `id`      | TEXT PK          |                                                           |
| `card_id` | TEXT             | FK → cards.id                                             |
| `ts`      | INTEGER          | epoch ms                                                  |
| `actor`   | TEXT             | `"human"` \| `"agent"`                                    |
| `action`  | TEXT             | `"set_status"` \| `"set_metadata"` \| `"set_connections"` |
| `from`    | TEXT (JSON) NULL | prior value(s) for the changed fields                     |
| `to`      | TEXT (JSON) NULL | new value(s)                                              |
| `reason`  | TEXT NULL        | required for `set_status`, optional otherwise             |

## Operations (the shared surface)

`board.ts` exports exactly these mutating operations plus reads. Every mutation
appends a `logs` row and carries an `actor`.

- `setStatus({ cardId, statusId, reason, actor })` — **requires** `statusId` and
  `reason`; moves the card, logs from/to status + reason.
- `setMetadata({ cardId, title?, description?, tags?, actor })` — partial update
  of title/description/tags.
- `setConnections({ cardId, artifacts?, predecessors?, successors?, parentId?, actor })`
  — updates edges. `successors` is accepted as sugar and translated into
  predecessor edits on the named cards.
- `createCard`, `deleteCard`, reorder helpers as needed by the UI.
- Reads: `getBoard()` (statuses + cards with derived successors/children),
  `getLogs(cardId?)`.

---

### Task 1: `node:sqlite` availability + board file path resolver

Confirms the driver loads under this repo's Deno flags and establishes where a
board DB lives.

**Files:**

- Add: `src/lib/kanban/paths.ts`
- Test: `src/lib/kanban/paths_test.ts`
- Maybe modify: `deno.json` (add unstable sqlite flag to `task test`/run if
  missing)

- [ ] **Step 1: Spike-verify the driver.** In scratch, run
      `deno eval --unstable-sqlite 'import { DatabaseSync } from "node:sqlite"; const d=new DatabaseSync(":memory:"); d.exec("create table t(x)"); console.log("ok")'`.
      If it errors on the flag, find the correct unstable flag for the installed
      Deno and record it. Wire that flag into `deno.json` tasks.
- [ ] **Step 2: Write failing test** for `boardPath(workspaceId)` →
      `~/.pique/boards/<id>.db` (expand `~` via the same home resolution
      `settings/file.ts` uses), and `ensureBoardsDir()`.
- [ ] **Step 3: Implement `paths.ts`.** Reuse `settings/file.ts`'s
      home/`~/.pique` resolution rather than re-deriving it.
- [ ] **Step 4:** `deno test -A src/lib/kanban/paths_test.ts` passes. Commit.

### Task 2: Schema + `board.ts` open/migrate/seed

Creates the DB, the three tables, and seeds statuses from settings on a fresh
board.

**Files:**

- Add: `src/lib/kanban/schema.ts` (DDL + a tiny migration guard)
- Add: `src/lib/kanban/board.ts` (open connection, `getBoard`, seed)
- Test: `src/lib/kanban/board_test.ts`

- [ ] **Step 1: Failing tests** — opening a board at a temp path creates the
      three tables; a fresh board with no statuses seeds from a passed-in
      `defaultStatuses` array (ordered); reopening is idempotent (no dup seed).
- [ ] **Step 2: Implement** `openBoard(dbPath, { defaultStatuses })` returning a
      handle with a live `DatabaseSync`; `getBoard()` returns
      `{ statuses, cards }` with `successors`/`children` derived. Use WAL
      (`PRAGMA journal_mode=WAL`).
- [ ] **Step 3:** Tests pass (use `:memory:` or a scratch temp file per test).
      Commit.

### Task 3: Mutating operations + logging

The core of the shared surface.

**Files:**

- Modify: `src/lib/kanban/board.ts`
- Test: `src/lib/kanban/board_test.ts`

- [ ] **Step 1: Failing tests**, one per operation:
  - `setStatus` moves the card, writes a `logs` row with `action="set_status"`,
    correct `from`/`to`, the `reason`, and `actor`; **throws if `reason` is
    missing/empty**.
  - `setMetadata` patches only provided fields; leaves others intact; logs the
    diff.
  - `setConnections` updates `predecessors`/`artifacts`/`parentId`; passing
    `successors:[B]` on card A adds A to B's predecessors; `getBoard` then shows
    A among B's predecessors and B among A's successors.
  - `createCard`/`deleteCard` round-trip; deleting a parent nulls children's
    `parent_id` and prunes dangling predecessor refs.
- [ ] **Step 2: Implement** each op as a single transaction (mutation + log
      append). ULID for ids.
- [ ] **Step 3:** Tests pass. Commit.

### Task 4: Settings — `kanban` section with default statuses

Adds board defaults to `~/.pique/settings.json` and a Settings section to edit
them.

**Files:**

- Modify: `src/lib/settings/bindings.ts` (`DEFAULT_SETTINGS.kanban`, `Settings`
  type)
- Modify: `src/lib/settings/store.ts` (merge `kanban` like `chat`/`workspace`)
- Modify: `src/lib/settings/SettingsModal.svelte` (new "Kanban" section —
  add/reorder/rename default statuses)
- Test: `src/lib/settings/store_test.ts`

- [ ] **Step 1: Failing test** — merge preserves a partial persisted `kanban`
      over defaults, like the existing `chat` merge test. Default: e.g.
      `["Backlog","Todo","In Progress","Done"]` as `{ name }[]` (ids assigned at
      seed time).
- [ ] **Step 2: Implement** the type + default + merge line. Add the
      SettingsModal section (list editor). With a 2nd+ section now present, add
      the deferred VS Code-style left nav rail noted in the settings memo.
- [ ] **Step 3:** store test passes; manually verify the section renders and
      round-trips. Commit.

### Task 5: Backend `kanban*` bindings

Exposes `board.ts` to the frontend, keyed by workspace id (board handles cached
per workspace in the backend).

**Files:**

- Modify: `src/desktop.ts` (register `kanban*` handlers; a per-`workspaceId`
  board-handle cache)
- Add: `src/lib/kanban/bindings.ts` (frontend contract, mirrors handlers)
- Test: covered via `board_test.ts` (handler layer is thin passthrough)

- [ ] **Step 1: Add handlers** — `kanbanGetBoard({workspaceId})`,
      `kanbanSetStatus`, `kanbanSetMetadata`, `kanbanSetConnections`,
      `kanbanCreateCard`, `kanbanDeleteCard`, `kanbanGetLogs`. Each
      resolves/opens the workspace's board (seeding from
      `settings.kanban.defaultStatuses`) and calls `board.ts`. `actor="human"`
      on this path.
- [ ] **Step 2:** Define `KanbanBindings` in `bindings.ts` matching arg/return
      shapes exactly.
- [ ] **Step 3:** Type-check (`deno check`), run suite. Commit.

### Task 6: `Kanban.svelte` module + registry

The visual board.

**Files:**

- Add: `src/lib/kanban/Kanban.svelte`
- Modify: `src/lib/modules/registry.ts` (register `kanban`)
- Modify: wherever modules are added to a view (module picker), so a Kanban tab
  can be opened

- [ ] **Step 1:** Component takes the module props (`viewId`, `tabId`, and the
      workspace id — thread workspace id down the same way `cwd` is threaded
      through `View`/`Column` if not already available). On mount, calls
      `kanbanGetBoard`. Renders one column per status (ordered by `position`),
      cards within.
- [ ] **Step 2:** Card interactions — drag between columns → `kanbanSetStatus`;
      **prompt for a change reason** on drop (required by the op). Click a card
      → detail panel to edit title/description/tags (→ `kanbanSetMetadata`) and
      connections (→ `kanbanSetConnections`). "New card" per column.
- [ ] **Step 3:** Register in `registry.ts`. Manually verify: open a Kanban tab,
      columns seed from settings defaults, create/move/edit a card, reopen the
      workspace and confirm persistence.

### Task 7: pi agent tool surface (the "agents use the same function calls" half)

A pi extension registering board tools that call `board.ts` in-process, with
`actor="agent"`.

**Files:**

- Add: `src/lib/kanban/agent-tools.ts` (or a pi extension package per the
  pi-extensions plan)
- Reference: `docs/superpowers/plans/2026-07-20-pi-extensions.md`,
  `src/lib/chat/agent.ts`

- [ ] **Step 1:** Determine how `startAgent()` registers extensions/tools (from
      the pi-extensions work). Register tools mirroring the operations:
      `kanban_get_board`, `kanban_set_status` (schema requires `card_id`,
      `status_id`, `reason`), `kanban_set_metadata`, `kanban_set_connections`.
      Each resolves the **current workspace's** board (the agent's
      `cwd`/workspace) and calls the same `board.ts` functions, tagging
      `actor="agent"`.
- [ ] **Step 2:** Verify with a running agent (needs LM Studio per the
      chat-defaults note): ask the agent to move a card with a reason; confirm
      the UI reflects it on refresh and a `logs` row shows `actor="agent"` +
      reason.

### Task 8: End-to-end verification

- [ ] Open two workspaces → each has an independent board file under
      `~/.pique/boards/`.
- [ ] Human drag with reason and agent move both land in `logs` with correct
      `actor`.
- [ ] Predecessor/successor and parent/child relationships render correctly and
      survive reopen.
- [ ] Full suite green (`deno task test`), `deno check` clean.

---

## Open design decisions (resolve during implementation)

1. **Reason capture UX for drag.** A required modal on every drop is safe but
   heavy. Alternative: allow a default/blank-but-logged reason for human drags,
   keeping the hard requirement only for the agent tool. Recommendation: require
   it, but make the prompt one-keystroke-dismissable with a sensible default
   like "manual move".
2. **Board handle lifecycle.** Cache open `DatabaseSync` handles per workspace
   id in the backend; decide when to close (workspace close vs app exit). WAL
   means leaving them open is fine short-term.
3. **`successors` derivation cost.** Deriving via `LIKE` on a JSON column is
   fine at board scale (tens–hundreds of cards). If it ever matters, add an
   index-friendly denormalized column — but not now (simplicity first).
