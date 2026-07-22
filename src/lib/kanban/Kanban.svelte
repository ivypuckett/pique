<script lang="ts">
  import { onMount } from "svelte";
  import { type Board, type CardRow, kanbanBindings } from "./bindings.ts";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  const b = kanbanBindings();

  let board = $state<Board>({ statuses: [], cards: [] });
  let error = $state("");
  const statusName = $derived(new Map(board.statuses.map((s) => [s.id, s.name])));
  const cardTitle = $derived(
    new Map(board.cards.map((c) => [c.id, c.title || "(untitled)"])),
  );

  async function refresh(): Promise<void> {
    if (!b || !workspaceId) return;
    try {
      board = await b.kanbanGetBoard({ workspaceId });
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(refresh);

  function cardsIn(statusId: string): CardRow[] {
    return board.cards.filter((c) => c.statusId === statusId).sort((a, b) => a.position - b.position);
  }

  // Drag-to-move. The board op requires a change reason, so a drop opens the reason
  // modal rather than moving immediately; confirming there commits the move.
  let dragId = $state<string | null>(null);
  let pending = $state<{ cardId: string; statusId: string } | null>(null);
  let reason = $state("");

  function onDrop(statusId: string): void {
    const cardId = dragId;
    dragId = null;
    if (!cardId) return;
    const card = board.cards.find((c) => c.id === cardId);
    if (!card || card.statusId === statusId) return;
    reason = "";
    pending = { cardId, statusId };
  }

  async function confirmMove(): Promise<void> {
    if (!b || !workspaceId || !pending || reason.trim() === "") return;
    try {
      await b.kanbanSetStatus({ workspaceId, ...pending, reason: reason.trim() });
      pending = null;
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function addCard(statusId: string): Promise<void> {
    if (!b || !workspaceId) return;
    try {
      const { id } = await b.kanbanCreateCard({ workspaceId, statusId, title: "New card" });
      await refresh();
      selectedId = id;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Card detail drawer.
  let selectedId = $state<string | null>(null);
  const selected = $derived(board.cards.find((c) => c.id === selectedId) ?? null);

  async function saveMetadata(): Promise<void> {
    if (!b || !workspaceId || !selected) return;
    try {
      await b.kanbanSetMetadata({
        workspaceId,
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
    if (!b || !workspaceId || !selected) return;
    try {
      await b.kanbanSetConnections({
        workspaceId,
        cardId: selected.id,
        artifacts: selected.artifacts,
        predecessors: selected.predecessors,
        parentId: selected.parentId,
      });
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function removeCard(): Promise<void> {
    if (!b || !workspaceId || !selected) return;
    try {
      await b.kanbanDeleteCard({ workspaceId, cardId: selected.id });
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

{#if !b}
  <div class="p-4 text-xs opacity-70">Available in the desktop app only.</div>
{:else}
  <div class="flex h-full min-h-0">
    <!-- Columns -->
    <div class="flex min-w-0 flex-1 gap-3 overflow-x-auto p-3">
      {#each board.statuses as s (s.id)}
        <div
          class="flex w-64 shrink-0 flex-col rounded bg-base-200"
          role="group"
          ondragover={(e) => e.preventDefault()}
          ondrop={() => onDrop(s.id)}
        >
          <div class="flex items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wide opacity-70">
            <span class="truncate">{s.name}</span>
            <span class="opacity-60">{cardsIn(s.id).length}</span>
          </div>
          <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
            {#each cardsIn(s.id) as c (c.id)}
              <button
                type="button"
                class="cursor-grab rounded border border-base-300 bg-base-100 p-2 text-left hover:border-primary"
                class:border-primary={selectedId === c.id}
                draggable="true"
                ondragstart={() => (dragId = c.id)}
                onclick={() => (selectedId = c.id)}
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
      {#if board.statuses.length === 0}
        <div class="p-4 text-xs opacity-60">No statuses. Configure default statuses in Settings → Kanban.</div>
      {/if}
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
          {#each board.cards.filter((c) => c.id !== selected.id) as c (c.id)}
            <option value={c.id}>{c.title || "(untitled)"}</option>
          {/each}
        </select>

        {#if selected.children.length > 0}
          <div class="text-xs opacity-70">Children: {selected.children.map((id) => cardTitle.get(id)).join(", ")}</div>
        {/if}

        <label class="text-xs opacity-70" for="k-preds">Predecessors</label>
        <select id="k-preds" class="select select-bordered select-sm h-24" multiple bind:value={selected.predecessors} onchange={saveConnections}>
          {#each board.cards.filter((c) => c.id !== selected.id) as c (c.id)}
            <option value={c.id}>{c.title || "(untitled)"}</option>
          {/each}
        </select>

        {#if selected.successors.length > 0}
          <div class="text-xs opacity-70">Successors: {selected.successors.map((id) => cardTitle.get(id)).join(", ")}</div>
        {/if}

        <button type="button" class="btn btn-ghost btn-xs mt-2 text-error" onclick={removeCard}>Delete card</button>
      </div>
    {/if}
  </div>

  {#if error}<div class="border-t border-base-300 px-3 py-1.5 text-xs text-error">{error}</div>{/if}

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
