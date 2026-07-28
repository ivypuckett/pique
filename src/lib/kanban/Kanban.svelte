<script lang="ts">
  import { onMount } from "svelte";
  import { type Board, type CardRow, type KanbanBindings, kanbanBindings } from "./bindings.ts";
  import { ROOT } from "../scope/paths.ts";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  const b = kanbanBindings();

  // Which board this module is showing: its own workspace's, or the shared root one
  // it inherits. Root itself has only one board, so the switcher is hidden there.
  const inRoot = $derived(workspaceId === ROOT);
  let showRoot = $state(false);
  const scope = $derived(inRoot || showRoot ? ROOT : workspaceId);

  let board = $state<Board>({ statuses: [], cards: [] });
  let error = $state("");
  const statusName = $derived(new Map(board.statuses.map((s) => [s.id, s.name])));
  const cardTitle = $derived(
    new Map(board.cards.map((c) => [c.id, c.title || "(untitled)"])),
  );

  async function refresh(): Promise<void> {
    if (!b || !scope) return;
    try {
      board = await b.kanbanGetBoard({ scope });
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(refresh);

  // Card ids are per-board, so a selection can't survive a switch — clear it before
  // reloading, or the drawer would show a card that isn't on the board any more.
  async function switchBoard(root: boolean): Promise<void> {
    showRoot = root;
    selectedId = null;
    await refresh();
  }

  function cardsIn(statusId: string): CardRow[] {
    return board.cards.filter((c) => c.statusId === statusId).sort((a, b) => a.position - b.position);
  }

  // Drag-to-move, implemented with pointer events rather than the HTML5 drag API,
  // which WebKitGTK (the desktop webview) doesn't support. A press that moves past a
  // small threshold becomes a drag; a press that doesn't is a click (card select).
  // Dropping over a different column opens the reason modal (the board op requires a
  // reason), and confirming there commits the move.
  let pending = $state<{ cardId: string; statusId: string } | null>(null);
  let reason = $state("");

  // Live drag state. `drag` is null until the press crosses the move threshold.
  let press: { cardId: string; fromStatus: string; x: number; y: number } | null = null;
  let drag = $state<{ cardId: string; fromStatus: string } | null>(null);
  let dragPos = $state({ x: 0, y: 0 });
  let overStatus = $state<string | null>(null);
  const DRAG_THRESHOLD = 5; // px before a press counts as a drag

  function onCardPointerDown(e: PointerEvent, cardId: string, fromStatus: string): void {
    if (e.button !== 0) return; // left button only
    press = { cardId, fromStatus, x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
      drag = { cardId: press.cardId, fromStatus: press.fromStatus };
    }
    dragPos = { x: e.clientX, y: e.clientY };
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overStatus = el?.closest("[data-status-id]")?.getAttribute("data-status-id") ?? null;
  }

  function onPointerUp(): void {
    const d = drag;
    const target = overStatus;
    const clickedCard = !drag && press ? press.cardId : null;
    press = null;
    drag = null;
    overStatus = null;
    if (d) {
      if (target && target !== d.fromStatus) {
        reason = "";
        pending = { cardId: d.cardId, statusId: target };
      }
      return;
    }
    // A press that never became a drag is a plain click → select the card.
    if (clickedCard) selectedId = clickedCard;
  }

  async function confirmMove(): Promise<void> {
    if (!b || !scope || !pending || reason.trim() === "") return;
    try {
      await b.kanbanSetStatus({ scope, ...pending, reason: reason.trim() });
      pending = null;
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function addCard(statusId: string): Promise<void> {
    if (!b || !scope) return;
    try {
      // Number the default title so new cards are distinguishable in the board and
      // in the parent/predecessor dropdowns until the user renames them.
      const title = `New card ${board.cards.length + 1}`;
      const { id } = await b.kanbanCreateCard({ scope, statusId, title });
      await refresh();
      selectedId = id;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Column edits. All four share one shape — call, refresh, surface any thrown message in
  // the error strip — so they share one wrapper. board.ts is the authority on what is
  // allowed (blank names, the last column, cascading deletes); this does not re-check.
  async function column(
    fn: (b: KanbanBindings, scope: string) => Promise<unknown>,
  ): Promise<void> {
    if (!b || !scope) return;
    let message = "";
    try {
      await fn(b, scope);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // Set after the refresh, not before: a successful refresh clears `error`, which
    // would otherwise swallow the message we just caught.
    await refresh();
    error = message;
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

  // An empty column goes straight away — there's nothing to lose. One with cards asks
  // first, because confirming deletes those cards along with it.
  let pendingDelete = $state<{ statusId: string; name: string; count: number } | null>(null);

  function deleteColumn(statusId: string, name: string): Promise<void> {
    const count = cardsIn(statusId).length;
    if (count > 0) {
      pendingDelete = { statusId, name, count };
      return Promise.resolve();
    }
    return column((b, scope) => b.kanbanDeleteStatus({ scope, statusId }));
  }

  async function confirmDeleteColumn(): Promise<void> {
    if (!pendingDelete) return;
    const { statusId } = pendingDelete;
    pendingDelete = null;
    // The drawer may be showing one of the cards about to go with the column.
    selectedId = null;
    await column((b, scope) => b.kanbanDeleteStatus({ scope, statusId, withCards: true }));
  }

  // Card detail drawer.
  let selectedId = $state<string | null>(null);
  const selected = $derived(board.cards.find((c) => c.id === selectedId) ?? null);

  // A card can't be parented under itself or any of its descendants (that would make
  // a cycle), so those are excluded from the parent dropdown; the backend rejects it
  // too, as the authority. Derived from the current parent edges.
  const invalidParents = $derived.by(() => {
    const out = new Set<string>();
    if (!selected) return out;
    const stack = [selected.id];
    while (stack.length) {
      const cur = stack.pop()!;
      out.add(cur);
      for (const c of board.cards) if (c.parentId === cur && !out.has(c.id)) stack.push(c.id);
    }
    return out;
  });

  // Cards eligible to add as a predecessor: not this card, not already a predecessor,
  // and not a successor (that would be an immediate cycle).
  const addablePredecessors = $derived.by(() => {
    if (!selected) return [];
    const taken = new Set([selected.id, ...selected.predecessors, ...selected.successors]);
    return board.cards.filter((c) => !taken.has(c.id));
  });

  function addPredecessor(id: string): void {
    if (!selected || !id || selected.predecessors.includes(id)) return;
    selected.predecessors = [...selected.predecessors, id];
    saveConnections();
  }
  function removePredecessor(id: string): void {
    if (!selected) return;
    selected.predecessors = selected.predecessors.filter((p) => p !== id);
    saveConnections();
  }

  async function saveMetadata(): Promise<void> {
    if (!b || !scope || !selected) return;
    try {
      await b.kanbanSetMetadata({
        scope,
        cardId: selected.id,
        title: selected.title,
        description: selected.description,
        tags: selected.tags,
      });
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveConnections(): Promise<void> {
    if (!b || !scope || !selected) return;
    try {
      await b.kanbanSetConnections({
        scope,
        cardId: selected.id,
        artifacts: selected.artifacts,
        predecessors: selected.predecessors,
        parentId: selected.parentId,
      });
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await refresh(); // resync so a rejected edit (e.g. a cycle) doesn't linger in the UI
    }
  }

  async function removeCard(): Promise<void> {
    if (!b || !scope || !selected) return;
    try {
      await b.kanbanDeleteCard({ scope, cardId: selected.id });
      selectedId = null;
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Tags are an editable kvp object; edit them as `key: value` lines in a textarea.
  let tagsText = $state("");
  $effect(() => {
    tagsText = selected
      ? Object.entries(selected.tags).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "";
  });
  function commitTags(): void {
    if (!selected) return;
    const tags: Record<string, string> = {};
    for (const line of tagsText.split("\n")) {
      const i = line.indexOf(":");
      if (i === -1) continue;
      const k = line.slice(0, i).trim();
      if (k) tags[k] = line.slice(i + 1).trim();
    }
    selected.tags = tags;
  }

  // Artifacts: one per line.
  let artifactsText = $state("");
  $effect(() => {
    artifactsText = selected ? selected.artifacts.join("\n") : "";
  });
  function commitArtifacts(): void {
    if (!selected) return;
    selected.artifacts = artifactsText.split("\n").map((s) => s.trim()).filter((s) => s !== "");
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} />

{#if !b}
  <div class="p-4 text-xs opacity-70">Available in the desktop app only.</div>
{:else}
  <div class="flex h-full min-h-0 flex-col">
    <!-- Board switcher: a workspace can work its own board or the shared root one it
         inherits. Hidden in root, which has no other board to switch to. -->
    {#if !inRoot}
      <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-3 py-1.5">
        <span class="mr-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">Board</span>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={!showRoot}
          aria-pressed={!showRoot}
          onclick={() => switchBoard(false)}
        >This workspace</button>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={showRoot}
          aria-pressed={showRoot}
          onclick={() => switchBoard(true)}
        >Root (shared)</button>
      </div>
    {/if}
  <div class="flex min-h-0 flex-1">
    <!-- Columns -->
    <div class="flex min-w-0 flex-1 gap-3 overflow-x-auto p-3">
      {#each board.statuses as s, i (s.id)}
        <div
          class="flex w-64 shrink-0 flex-col rounded bg-base-200 ring-2 ring-transparent transition-colors"
          class:ring-primary={drag && overStatus === s.id && drag.fromStatus !== s.id}
          role="group"
          data-status-id={s.id}
        >
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
                onclick={() => deleteColumn(s.id, s.name)}
              >✕</button>
            </div>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {#each cardsIn(s.id) as c (c.id)}
              <button
                type="button"
                class="cursor-grab touch-none select-none rounded border border-base-300 bg-base-100 p-2 text-left hover:border-primary"
                class:border-primary={selectedId === c.id}
                class:opacity-40={drag?.cardId === c.id}
                onpointerdown={(e) => onCardPointerDown(e, c.id, s.id)}
              >
                <div class="truncate text-sm">{c.title || "(untitled)"}</div>
                {#if Object.keys(c.tags).length > 0}
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#each Object.entries(c.tags) as [k, v] (k)}
                      <span class="badge badge-ghost badge-xs">{k}: {v}</span>
                    {/each}
                  </div>
                {/if}
              </button>
            {/each}
            <button type="button" class="btn btn-ghost btn-xs mt-1 justify-start" onclick={() => addCard(s.id)}>
              + Add card
            </button>
          </div>
        </div>
      {/each}
      <!-- A board can no longer reach zero columns (deleteStatus refuses the last one, and
           the seed is never empty), so this is the only column affordance needed here. -->
      <button
        type="button"
        class="btn btn-ghost h-auto w-40 shrink-0 self-start justify-start border border-dashed border-base-300 py-2 text-xs font-normal opacity-70"
        onclick={addColumn}
      >+ Add column</button>
    </div>

    <!-- Detail drawer -->
    {#if selected}
      <div class="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-base-300 bg-base-100 p-3">
        <div class="flex items-center justify-between">
          <span class="text-xs uppercase tracking-wide text-primary">Card</span>
          <button type="button" class="btn btn-square btn-ghost btn-xs" aria-label="Close card" onclick={() => (selectedId = null)}>✕</button>
        </div>

        <label class="text-xs opacity-70" for="k-title">Title</label>
        <input id="k-title" class="input input-bordered input-sm" bind:value={selected.title} onblur={saveMetadata} />

        <label class="text-xs opacity-70" for="k-desc">Description</label>
        <textarea id="k-desc" class="textarea textarea-bordered textarea-sm" rows="4" bind:value={selected.description} onblur={saveMetadata}></textarea>

        <label class="text-xs opacity-70" for="k-tags">Tags (<code>key: value</code> per line)</label>
        <textarea id="k-tags" class="textarea textarea-bordered textarea-sm font-mono" rows="3" bind:value={tagsText} onblur={() => { commitTags(); saveMetadata(); }}></textarea>

        <label class="text-xs opacity-70" for="k-artifacts">Artifacts (one per line)</label>
        <textarea id="k-artifacts" class="textarea textarea-bordered textarea-sm font-mono" rows="2" bind:value={artifactsText} onblur={() => { commitArtifacts(); saveConnections(); }}></textarea>

        <label class="text-xs opacity-70" for="k-parent">Parent</label>
        <select id="k-parent" class="select select-bordered select-sm" bind:value={selected.parentId} onchange={saveConnections}>
          <option value={null}>— none —</option>
          {#each board.cards.filter((c) => !invalidParents.has(c.id)) as c (c.id)}
            <option value={c.id}>{c.title || "(untitled)"}</option>
          {/each}
        </select>

        {#if selected.children.length > 0}
          <div class="text-xs opacity-70">Children: {selected.children.map((id) => cardTitle.get(id)).join(", ")}</div>
        {/if}

        <div>
          <div class="text-xs opacity-70">Predecessors</div>
          <div class="mt-0.5 text-xs opacity-50">Cards that must be finished before this one.</div>
          {#if selected.predecessors.length > 0}
            <div class="mt-1.5 flex flex-wrap gap-1">
              {#each selected.predecessors as id (id)}
                <span class="badge badge-outline badge-sm gap-1">
                  {cardTitle.get(id) ?? id}
                  <button type="button" class="opacity-60 hover:opacity-100" aria-label="Remove predecessor {cardTitle.get(id) ?? id}" onclick={() => removePredecessor(id)}>✕</button>
                </span>
              {/each}
            </div>
          {:else}
            <div class="mt-1.5 text-xs opacity-40">None</div>
          {/if}
          {#if addablePredecessors.length > 0}
            <select
              class="select select-bordered select-sm mt-1.5 w-full"
              aria-label="Add predecessor"
              onchange={(e) => { addPredecessor(e.currentTarget.value); e.currentTarget.value = ""; }}
            >
              <option value="">+ Add predecessor…</option>
              {#each addablePredecessors as c (c.id)}
                <option value={c.id}>{c.title || "(untitled)"}</option>
              {/each}
            </select>
          {/if}
        </div>

        <div>
          <div class="text-xs opacity-70">Successors <span class="opacity-50">· automatic</span></div>
          <div class="mt-0.5 text-xs opacity-50">Cards that list this one as a predecessor.</div>
          {#if selected.successors.length > 0}
            <div class="mt-1.5 flex flex-wrap gap-1">
              {#each selected.successors as id (id)}
                <span class="badge badge-ghost badge-sm">{cardTitle.get(id) ?? id}</span>
              {/each}
            </div>
          {:else}
            <div class="mt-1.5 text-xs opacity-40">None</div>
          {/if}
        </div>

        <button type="button" class="btn btn-ghost btn-xs mt-2 text-error" onclick={removeCard}>Delete card</button>
      </div>
    {/if}
  </div>
  </div>

  {#if error}<div class="border-t border-base-300 px-3 py-1.5 text-xs text-error">{error}</div>{/if}

  <!-- Floating preview of the card being dragged, following the cursor. -->
  {#if drag}
    <div
      class="pointer-events-none fixed z-50 max-w-56 truncate rounded border border-primary bg-base-100 px-2 py-1 text-sm shadow-lg"
      style="left: {dragPos.x + 12}px; top: {dragPos.y + 12}px;"
    >
      {cardTitle.get(drag.cardId) ?? "(untitled)"}
    </div>
  {/if}

  <!-- Delete-a-non-empty-column confirmation -->
  <div class="modal" class:modal-open={pendingDelete !== null} role="dialog" aria-modal="true">
    <div class="modal-box max-w-sm">
      {#if pendingDelete}
        <div class="text-sm">
          Delete <span class="font-medium">{pendingDelete.name}</span>
          and its {pendingDelete.count}
          {pendingDelete.count === 1 ? "card" : "cards"}?
        </div>
        <div class="mt-1 text-xs opacity-60">This can't be undone.</div>
      {/if}
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (pendingDelete = null)}>Cancel</button>
        <button type="button" class="btn btn-error btn-sm" onclick={confirmDeleteColumn}>Delete</button>
      </div>
    </div>
  </div>

  <!-- Reason-required move modal -->
  <div class="modal" class:modal-open={pending !== null} role="dialog" aria-modal="true">
    <div class="modal-box max-w-sm">
      {#if pending}
        <div class="text-sm">
          Move <span class="font-medium">{cardTitle.get(pending.cardId)}</span>
          to <span class="font-medium">{statusName.get(pending.statusId)}</span>
        </div>
      {/if}
      <label class="mt-3 block text-xs opacity-70" for="k-reason">Change reason (required)</label>
      <input
        id="k-reason"
        class="input input-bordered input-sm mt-1 w-full"
        bind:value={reason}
        onkeydown={(e) => e.key === "Enter" && confirmMove()}
      />
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (pending = null)}>Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" disabled={reason.trim() === ""} onclick={confirmMove}>Move</button>
      </div>
    </div>
  </div>
{/if}
