# Editable Board Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human add, rename, reorder, and delete the columns of an existing Kanban board — including root's shared board — from the Kanban module itself.

**Architecture:** The board becomes the source of truth for its own columns. Four new mutations on `BoardHandle` (`addStatus`, `renameStatus`, `moveStatus`, `deleteStatus`) are exposed through four `win.bind` handlers and edited from the column header in `Kanban.svelte`. Settings → `kanban.defaultStatuses` keeps its current job unchanged — the seed for boards that don't exist yet — and its copy is corrected to say so. Every new call carries the existing `scope` argument, so "edit root's columns from ws-1" comes free and the visibility rule from `scope/paths.ts` is preserved unchanged.

**Tech Stack:** Deno, `node:sqlite`, Svelte 5 (runes), Tailwind + daisyUI, `deno test`.

---

## Background: why this is needed

`openBoard` seeds the `statuses` table only when the board has zero rows
([board.ts:128](../../../src/lib/kanban/board.ts:128)), and `BoardHandle` exposes no status
mutation at all ([board.ts:47](../../../src/lib/kanban/board.ts:47)). The board file is
created the first time a Kanban module opens in a scope, so `defaultStatuses` is editable
only in the window *before* anyone has ever looked at that scope's board. After that the
columns are frozen forever.

## Decisions locked in before coding

These were settled during design. Do not re-litigate them mid-task.

1. **Settings stays the seed.** Do not make Settings → Kanban reconcile into a live board.
   Matching a name list against rows that have ids and attached cards is ambiguous by
   construction (a rename and a delete-plus-add look identical).
2. **Deleting a column with cards is refused,** not resolved by moving cards. Moving them
   implicitly would need a `set_status` log entry with an invented reason, and `setStatus`
   already refuses a blank one ([board.ts:206](../../../src/lib/kanban/board.ts:206)).
3. **Deleting the last remaining column is refused.** Otherwise the board reaches zero
   statuses and the next `openBoard` silently re-seeds it with the defaults — a confusing
   resurrection. Refusing keeps the count ≥ 1 forever, so the seed guard can never fire
   again on an existing board.
4. **Column edits are not logged.** The `logs` table is card-scoped (`card_id NOT NULL`,
   [schema.ts:25](../../../src/lib/kanban/schema.ts:25)). A column edit is not a card event.
   Do not add a schema migration for it.
5. **Agent tools are out of scope.** No `kanban_set_statuses` in this plan. An agent
   restructuring the columns under a human is a bigger call than it looks, and adding it
   later is a thin wrapper over the same `board.ts` methods.
6. **Renames are id-stable.** Status ids are UUIDs, so a rename touches neither
   `cards.status_id` nor the `{statusId}` payloads already written into `logs`. A *deleted*
   column does leave its raw id in old log rows, which is accepted — there is no log viewer
   in the UI today, so it has no visible surface.

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `src/lib/kanban/board.ts` | Modify | Adds the four status mutations to `BoardHandle`; still the only module that touches SQL. |
| `src/lib/kanban/board_test.ts` | Modify | Gains a `Deno.test` per mutation plus the two refusal cases. |
| `src/lib/kanban/bindings.ts` | Modify | Frontend half of the contract — four new method signatures on `KanbanBindings`. |
| `src/desktop.ts` | Modify | Backend half — four new `kanban*` `win.bind` handlers next to the existing ones. |
| `src/lib/kanban/Kanban.svelte` | Modify | Column header becomes editable; a "+ Add column" affordance ends the column row. |
| `src/lib/settings/SettingsModal.svelte` | Modify | Copy fix only — say the seed applies to boards that don't exist yet. |
| `docs/scopes.md` | Modify | Kanban section records that columns are board-owned and settings is the seed. |

---

### Task 1: Status mutations on the board

**Files:**
- Modify: `src/lib/kanban/board.ts` (interface at :47, returned object at :162)
- Test: `src/lib/kanban/board_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/kanban/board_test.ts`. The `fresh()` helper at the top of that file
already gives a seeded in-memory board plus a name→id lookup — use it.

```ts
Deno.test("addStatus appends a column at the end and returns its id", () => {
  const { b } = fresh();
  const id = b.addStatus({ name: "Blocked" });
  const statuses = b.getBoard().statuses;
  assertEquals(statuses.map((s) => s.name), ["Backlog", "Todo", "In Progress", "Done", "Blocked"]);
  assertEquals(statuses.map((s) => s.position), [0, 1, 2, 3, 4]);
  assertEquals(statuses.at(-1)!.id, id);
  b.close();
});

Deno.test("addStatus rejects a blank name", () => {
  const { b } = fresh();
  assertThrows(() => b.addStatus({ name: "   " }), Error, "column name cannot be empty");
  b.close();
});

Deno.test("renameStatus changes the name and keeps the id, so cards stay put", () => {
  const { b, status } = fresh();
  const todo = status("Todo");
  const cardId = b.createCard({ statusId: todo, title: "x", actor: "human" });
  b.renameStatus({ statusId: todo, name: "Next" });
  assertEquals(b.getBoard().statuses.map((s) => s.name), ["Backlog", "Next", "In Progress", "Done"]);
  assertEquals(card(b, cardId).statusId, todo);
  b.close();
});

Deno.test("renameStatus rejects a blank name", () => {
  const { b, status } = fresh();
  assertThrows(() => b.renameStatus({ statusId: status("Todo"), name: "" }), Error, "column name cannot be empty");
  b.close();
});

Deno.test("moveStatus splices a column to an absolute index and renumbers", () => {
  const { b, status } = fresh();
  b.moveStatus({ statusId: status("Done"), position: 0 });
  assertEquals(b.getBoard().statuses.map((s) => s.name), ["Done", "Backlog", "Todo", "In Progress"]);
  assertEquals(b.getBoard().statuses.map((s) => s.position), [0, 1, 2, 3]);
  b.close();
});

Deno.test("moveStatus clamps an out-of-range position instead of throwing", () => {
  const { b, status } = fresh();
  b.moveStatus({ statusId: status("Backlog"), position: 99 });
  assertEquals(b.getBoard().statuses.map((s) => s.name), ["Todo", "In Progress", "Done", "Backlog"]);
  b.moveStatus({ statusId: status("Backlog"), position: -5 });
  assertEquals(b.getBoard().statuses.map((s) => s.name), ["Backlog", "Todo", "In Progress", "Done"]);
  b.close();
});

Deno.test("deleteStatus removes an empty column and renumbers the rest", () => {
  const { b, status } = fresh();
  b.deleteStatus({ statusId: status("In Progress") });
  const statuses = b.getBoard().statuses;
  assertEquals(statuses.map((s) => s.name), ["Backlog", "Todo", "Done"]);
  assertEquals(statuses.map((s) => s.position), [0, 1, 2]);
  b.close();
});

Deno.test("deleteStatus refuses a column that still has cards", () => {
  const { b, status } = fresh();
  b.createCard({ statusId: status("Todo"), title: "x", actor: "human" });
  b.createCard({ statusId: status("Todo"), title: "y", actor: "human" });
  assertThrows(
    () => b.deleteStatus({ statusId: status("Todo") }),
    Error,
    "cannot delete a column that still has cards (2 remaining)",
  );
  assertEquals(b.getBoard().statuses.length, 4);
  b.close();
});

Deno.test("deleteStatus refuses the last remaining column", () => {
  const b = openBoard(":memory:", { defaultStatuses: [{ name: "Only" }] });
  const only = b.getBoard().statuses[0].id;
  assertThrows(() => b.deleteStatus({ statusId: only }), Error, "a board needs at least one column");
  b.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
deno test -A src/lib/kanban/board_test.ts
```

Expected: FAIL — `Property 'addStatus' does not exist on type 'BoardHandle'` (and the same
for the other three).

- [ ] **Step 3: Add the four methods to the `BoardHandle` interface**

In `src/lib/kanban/board.ts`, inside `export interface BoardHandle`, add these directly
after `getLogs(...)` and before `createCard(...)`:

```ts
  // Column edits. Ids are stable across a rename, so cards and existing log payloads
  // are untouched by one. None of these are logged: the logs table is card-scoped.
  addStatus(arg: { name: string }): string;
  renameStatus(arg: { statusId: string; name: string }): void;
  moveStatus(arg: { statusId: string; position: number }): void;
  deleteStatus(arg: { statusId: string }): void;
```

- [ ] **Step 4: Implement the four methods**

In `src/lib/kanban/board.ts`, add this helper next to `nextPosition` (around :136):

```ts
  // Rewrite every status position to its index in `ids`, so an insert, move or delete
  // always leaves a dense 0..n-1 ordering.
  const renumber = (ids: string[]): void => {
    const upd = db.prepare("UPDATE statuses SET position = ? WHERE id = ?");
    ids.forEach((id, i) => upd.run(i, id));
  };

  const statusIds = (): string[] =>
    (db.prepare("SELECT id FROM statuses ORDER BY position").all() as unknown as { id: string }[])
      .map((r) => r.id);

  const cleanName = (name: string): string => {
    const n = name.trim();
    if (n === "") throw new Error("column name cannot be empty");
    return n;
  };
```

Then add the four methods to the returned object, directly after `getLogs(...)` and before
`createCard(...)`:

```ts
    addStatus({ name }) {
      const clean = cleanName(name);
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO statuses (id, name, position) VALUES (?, ?, ?)").run(
        id,
        clean,
        statusIds().length,
      );
      return id;
    },

    renameStatus({ statusId, name }) {
      db.prepare("UPDATE statuses SET name = ? WHERE id = ?").run(cleanName(name), statusId);
    },

    moveStatus({ statusId, position }) {
      const ids = statusIds();
      const from = ids.indexOf(statusId);
      if (from === -1) return;
      const to = Math.max(0, Math.min(position, ids.length - 1));
      ids.splice(from, 1);
      ids.splice(to, 0, statusId);
      renumber(ids);
    },

    deleteStatus({ statusId }) {
      const ids = statusIds();
      if (ids.length <= 1) throw new Error("a board needs at least one column");
      const { c } = db.prepare("SELECT count(*) c FROM cards WHERE status_id = ?").get(
        statusId,
      ) as { c: number };
      if (c > 0) {
        throw new Error(`cannot delete a column that still has cards (${c} remaining)`);
      }
      db.prepare("DELETE FROM statuses WHERE id = ?").run(statusId);
      renumber(ids.filter((id) => id !== statusId));
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
deno test -A src/lib/kanban/
```

Expected: PASS — every test in `board_test.ts`, `service_test.ts` and `agent-tools_test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kanban/board.ts src/lib/kanban/board_test.ts
git commit -m "feat(kanban): add, rename, reorder and delete board columns"
```

---

### Task 2: Wire the mutations through the binding contract

The two halves of this contract live in separate module graphs and are kept in sync by
hand — see the comment at the top of `bindings.ts`. Both halves change in this one task so
they can never be committed out of step.

**Files:**
- Modify: `src/lib/kanban/bindings.ts` (interface at :11)
- Modify: `src/desktop.ts` (kanban handlers at :244-321)

- [ ] **Step 1: Add the four signatures to `KanbanBindings`**

In `src/lib/kanban/bindings.ts`, add these to `export interface KanbanBindings`, directly
after `kanbanGetLogs`:

```ts
  kanbanAddStatus(arg: { scope: string; name: string }): Promise<{ id: string }>;
  kanbanRenameStatus(arg: { scope: string; statusId: string; name: string }): Promise<unknown>;
  kanbanMoveStatus(arg: { scope: string; statusId: string; position: number }): Promise<unknown>;
  kanbanDeleteStatus(arg: { scope: string; statusId: string }): Promise<unknown>;
```

- [ ] **Step 2: Add the four `win.bind` handlers**

In `src/desktop.ts`, add these directly after the `kanbanGetLogs` handler (which ends at
:256) and before `kanbanCreateCard`:

```ts
// Column edits. Same scope argument as every other kanban call, so a workspace can edit
// the shared root board's columns and nothing can reach a workspace board from outside.
// board.ts refuses a blank name, a column that still has cards, and the last column; the
// thrown message surfaces in the module's error strip.
win.bind("kanbanAddStatus", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  return { id: (await kanban.board(scope)).addStatus({ name }) };
});

win.bind("kanbanRenameStatus", async (arg) => {
  const { scope, statusId, name } = arg as { scope: string; statusId: string; name: string };
  (await kanban.board(scope)).renameStatus({ statusId, name });
  return true;
});

win.bind("kanbanMoveStatus", async (arg) => {
  const { scope, statusId, position } = arg as {
    scope: string;
    statusId: string;
    position: number;
  };
  (await kanban.board(scope)).moveStatus({ statusId, position });
  return true;
});

win.bind("kanbanDeleteStatus", async (arg) => {
  const { scope, statusId } = arg as { scope: string; statusId: string };
  (await kanban.board(scope)).deleteStatus({ statusId });
  return true;
});
```

- [ ] **Step 3: Verify both halves typecheck**

```bash
deno check src/desktop.ts src/lib/kanban/bindings.ts
```

Expected: no errors. There is no unit test for this layer — `win.bind` needs the desktop
runtime — so the typecheck plus Task 3's manual verification is the coverage.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kanban/bindings.ts src/desktop.ts
git commit -m "feat(kanban): bind column mutations to the frontend"
```

---

### Task 3: Edit columns from the Kanban module

**Files:**
- Modify: `src/lib/kanban/Kanban.svelte` (script around :108, column markup at :262-301)

- [ ] **Step 1: Add the column action helpers**

First widen the existing import at :2 to bring the binding type in — the wrapper below is
typed against it:

```ts
  import { type Board, type CardRow, type KanbanBindings, kanbanBindings } from "./bindings.ts";
```

Then add this to the `<script>` block directly after the `addCard` function (which ends at
:120). The wrapper hands the callback both the binding handle and the scope, so neither
needs a non-null assertion at the call sites:

```ts
  // Column edits. All four share one shape — call, refresh, surface any thrown message in
  // the error strip — so they share one wrapper. board.ts is the authority on what is
  // allowed (blank names, non-empty columns, the last column); this does not re-check.
  async function column(
    fn: (b: KanbanBindings, scope: string) => Promise<unknown>,
  ): Promise<void> {
    if (!b || !scope) return;
    try {
      await fn(b, scope);
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await refresh();
  }

  function addColumn(): Promise<void> {
    const name = `New column ${board.statuses.length + 1}`;
    return column((b, scope) => b.kanbanAddStatus({ scope, name }));
  }

  // Committed on blur and on Enter. A blank or unchanged name is a no-op that just
  // refreshes, which re-renders the input from `board` — so it snaps back on its own.
  function renameColumn(statusId: string, name: string, was: string): Promise<void> {
    if (name.trim() === "" || name === was) return refresh();
    return column((b, scope) => b.kanbanRenameStatus({ scope, statusId, name }));
  }

  function moveColumn(statusId: string, position: number): Promise<void> {
    return column((b, scope) => b.kanbanMoveStatus({ scope, statusId, position }));
  }

  function deleteColumn(statusId: string): Promise<void> {
    return column((b, scope) => b.kanbanDeleteStatus({ scope, statusId }));
  }
```

- [ ] **Step 2: Replace the column header markup**

In `src/lib/kanban/Kanban.svelte`, replace the header block at :269-272:

```svelte
          <div class="flex items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wide opacity-70">
            <span class="truncate">{s.name}</span>
            <span class="opacity-60">{cardsIn(s.id).length}</span>
          </div>
```

with:

```svelte
          <!-- The name is an always-editable borderless input; the reorder/delete controls
               stay hidden until the column is hovered or something inside it has focus, so
               a resting board still reads as plain column headers. -->
          <div class="group flex items-center gap-1 px-3 py-2 text-xs font-medium uppercase tracking-wide opacity-70">
            <input
              class="min-w-0 flex-1 truncate rounded bg-transparent uppercase outline-none focus:bg-base-100 focus:px-1 focus:ring-1 focus:ring-primary"
              aria-label="Rename column {s.name}"
              value={s.name}
              onblur={(e) => renameColumn(s.id, e.currentTarget.value, s.name)}
              onkeydown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { e.currentTarget.value = s.name; e.currentTarget.blur(); }
              }}
            />
            <span class="shrink-0 opacity-60">{cardsIn(s.id).length}</span>
            <div class="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                class="btn btn-square btn-ghost btn-xs"
                aria-label="Move column {s.name} left"
                disabled={i === 0}
                onclick={() => moveColumn(s.id, i - 1)}
              >←</button>
              <button
                type="button"
                class="btn btn-square btn-ghost btn-xs"
                aria-label="Move column {s.name} right"
                disabled={i === board.statuses.length - 1}
                onclick={() => moveColumn(s.id, i + 1)}
              >→</button>
              <button
                type="button"
                class="btn btn-square btn-ghost btn-xs"
                aria-label="Delete column {s.name}"
                onclick={() => deleteColumn(s.id)}
              >✕</button>
            </div>
          </div>
```

This needs the column index, so change the `{#each}` at :262 from:

```svelte
      {#each board.statuses as s (s.id)}
```

to:

```svelte
      {#each board.statuses as s, i (s.id)}
```

- [ ] **Step 3: Add the "+ Add column" affordance and fix the empty-state copy**

Replace the block at :298-300:

```svelte
      {#if board.statuses.length === 0}
        <div class="p-4 text-xs opacity-60">No statuses. Configure default statuses in Settings → Kanban.</div>
      {/if}
```

with:

```svelte
      <button
        type="button"
        class="btn btn-ghost h-auto w-40 shrink-0 self-start justify-start border border-dashed border-base-300 py-2 text-xs font-normal opacity-70"
        onclick={addColumn}
      >+ Add column</button>
```

The old empty state goes away: `deleteStatus` refuses the last column and
`resolveKanbanDefaults` never yields an empty seed, so a board can no longer have zero
columns — and if one somehow did, "+ Add column" is the fix, not a trip to Settings.

- [ ] **Step 4: Verify the module typechecks and the suite is green**

```bash
deno run -A npm:vite build && deno test -A src/
```

Expected: the Svelte build completes with no errors, and every test passes.

- [ ] **Step 5: Verify it in the running app**

```bash
deno task dev
```

In the app, with root focused, open a Kanban module and check all five behaviours:

1. Click a column name, type a new one, press Enter → the header keeps the new name after
   the refresh, and any cards in it stay put.
2. Hover a column → ← → ✕ appear. Click → → the column swaps with its right neighbour.
3. Click "+ Add column" → a "New column N" appears at the right-hand end.
4. Click ✕ on the empty new column → it disappears.
5. Click ✕ on a column that has a card → the column stays and the strip at the bottom of
   the module reads `cannot delete a column that still has cards (1 remaining)`.

Then switch to a numbered workspace, set its Kanban switcher to "Root (shared)", and rename
a column — the change must land on root's board, and be visible from root.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kanban/Kanban.svelte
git commit -m "feat(kanban): edit board columns from the module"
```

---

### Task 4: Correct the settings copy and the docs

`defaultStatuses` did not change behaviour, but its description in the UI ("Applies to
boards created after the change, not existing ones") is now both true and misleading — it
implies a later chance to fix the columns that never comes. Say what it actually is.

**Files:**
- Modify: `src/lib/settings/SettingsModal.svelte` (help text at :457-460, comment at :331-333)
- Modify: `docs/scopes.md` (Kanban board section at :64-99)

- [ ] **Step 1: Fix the Settings help text**

In `src/lib/settings/SettingsModal.svelte`, replace:

```svelte
      <div class="mt-0.5 text-xs opacity-70">
        The columns a new board in this scope starts with, in order. Applies to boards
        created after the change, not existing ones.
      </div>
```

with:

```svelte
      <div class="mt-0.5 text-xs opacity-70">
        The columns a board in this scope starts with, in order. A scope's board is created
        the first time its Kanban module opens; after that, edit its columns on the board
        itself.
      </div>
```

- [ ] **Step 2: Fix the stale comment above `setStatuses`**

Replace the comment at :331-333:

```ts
  // Default statuses seeded into a new board in the selected scope (kanban/board.ts).
  // Editing here only affects boards created afterward, not existing ones. Every edit
  // writes the whole list, which is also what stops the scope inheriting root's.
```

with:

```ts
  // Default statuses seeded into a new board in the selected scope (kanban/board.ts).
  // Seed only — an existing board's columns are edited on the board (Kanban.svelte).
  // Every edit writes the whole list, which is also what stops the scope inheriting root's.
```

- [ ] **Step 3: Record the ownership rule in `docs/scopes.md`**

In the `### The Kanban board` section, append after the existing paragraphs:

```markdown
A board owns its own columns. `kanban.defaultStatuses` in a scope's config seeds a board
that does not exist yet — which in practice means before that scope's Kanban module has
ever been opened — and after that the columns are added, renamed, reordered and deleted on
the board itself. Those edits take the same `scope` argument as every other Kanban call, so
a workspace can restructure the shared root board and nothing can reach a workspace's board
from outside it.

Two refusals keep the data honest: a column that still holds cards cannot be deleted (move
them first — an implicit move would need a `set_status` reason nobody supplied), and the
last remaining column cannot be deleted (a board with zero columns would be silently
re-seeded from the defaults on next open). Column edits are not written to the card log,
which is card-scoped by schema.
```

- [ ] **Step 4: Check nothing else in the docs still claims columns are fixed**

```bash
grep -rn "defaultStatuses\|created after the change\|Configure default statuses" docs/ src/
```

Expected: no remaining prose saying an existing board's columns cannot change. Fix any that
turns up.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings/SettingsModal.svelte docs/scopes.md
git commit -m "docs(kanban): defaultStatuses is a seed; columns are edited on the board"
```

---

## Out of scope (deliberately)

- **Agent-facing column tools.** No `kanban_set_statuses`. Decision 5 above.
- **Live reload into other open Kanban modules.** A second module showing the same board
  will not see a column change until it refreshes — the same caveat as deferred #2 in
  `docs/scopes.md`. Unchanged by this work.
- **Column colours, WIP limits, per-column card ordering rules.** Not asked for.
- **Drag-to-reorder columns.** The ← → buttons cover it; the existing pointer-drag code is
  card-specific and reusing it here is a larger change than the need justifies.
