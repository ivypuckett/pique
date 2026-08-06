<script lang="ts">
  import { onMount, tick } from "svelte";
  import { type Board, type CardRow, type KanbanBindings, kanbanBindings } from "./bindings.ts";
  import { ROOT } from "../scope/paths.ts";
  import ConfirmDialog from "../ConfirmDialog.svelte";

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
  // Cards carry no default title, so an untitled one stands in as "Untitled" wherever
  // it is named — plain text here, and hint-styled where there is room to style it.
  const cardTitle = $derived(
    new Map(board.cards.map((c) => [c.id, c.title || "Untitled"])),
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
  // reason), and confirming there commits the move. Dropping inside the card's own
  // column reorders it there, which is only an ordering change and needs no reason.
  let pending = $state<{ cardId: string; statusId: string } | null>(null);
  let reason = $state("");

  // Live drag state. `drag` is null until the press crosses the move threshold.
  let press: { cardId: string; fromStatus: string; x: number; y: number } | null = null;
  let drag = $state<{ cardId: string; fromStatus: string } | null>(null);
  let dragPos = $state({ x: 0, y: 0 });
  let overStatus = $state<string | null>(null);
  // Where the card would land in its own column: `index` into the rendered list (the
  // dragged card included), `y` the insertion line's offset inside the card list.
  let dropAt = $state<{ index: number; y: number } | null>(null);
  const DRAG_THRESHOLD = 5; // px before a press counts as a drag

  function onCardPointerDown(e: PointerEvent, cardId: string, fromStatus: string): void {
    if (e.button !== 0) return; // left button only
    press = { cardId, fromStatus, x: e.clientX, y: e.clientY };
  }

  // The insertion point for pointer position `y` in a column's card list: the gap the
  // pointer is nearest, found by counting the cards whose midpoint it has passed. The
  // line is measured against the list's scrolled content, not the viewport, and drawn
  // absolutely — inserting a real element would shift the cards it is measured from.
  function insertionAt(list: HTMLElement, y: number): { index: number; y: number } {
    const rects = [...list.querySelectorAll("[data-card-id]")].map((el) =>
      el.getBoundingClientRect()
    );
    const index = rects.filter((r) => (r.top + r.bottom) / 2 < y).length;
    const top = list.getBoundingClientRect().top - list.scrollTop;
    const edge = index < rects.length
      ? rects[index].top - 4
      : (rects[rects.length - 1]?.bottom ?? top) + 4;
    // Cards sit flush with the top of the list, so the gap the first one would take is
    // negative — clamp it, or the line lands outside the scroll box and is clipped away.
    return { index, y: Math.max(0, edge - top) };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD) return;
      drag = { cardId: press.cardId, fromStatus: press.fromStatus };
    }
    dragPos = { x: e.clientX, y: e.clientY };
    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-status-id]");
    overStatus = col?.getAttribute("data-status-id") ?? null;
    const list = overStatus === drag.fromStatus
      ? col?.querySelector("[data-cards]") as HTMLElement | null
      : null;
    dropAt = list ? insertionAt(list, e.clientY) : null;
  }

  function onPointerUp(): void {
    const d = drag;
    const target = overStatus;
    const at = dropAt;
    const clickedCard = !drag && press ? press.cardId : null;
    press = null;
    drag = null;
    overStatus = null;
    dropAt = null;
    if (d) {
      if (target && target !== d.fromStatus) {
        reason = "";
        pending = { cardId: d.cardId, statusId: target };
      } else if (at) {
        reorder(d.cardId, d.fromStatus, at.index);
      }
      return;
    }
    // A press that never became a drag is a plain click → select the card.
    if (clickedCard) selectedId = clickedCard;
  }

  // `index` is an insertion point in the list as rendered; once the card is lifted out,
  // every gap below it shifts up one — so a downward move lands one earlier.
  async function reorder(cardId: string, statusId: string, index: number): Promise<void> {
    const from = cardsIn(statusId).findIndex((c) => c.id === cardId);
    const position = index > from ? index - 1 : index;
    if (!b || !scope || from === -1 || position === from) return;
    try {
      await b.kanbanMoveCard({ scope, cardId, position });
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
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
      // No default title. A real one ("New card 3") is text the user has to clear
      // before typing their own; an untitled card shows a hint instead, which the
      // title they type simply replaces.
      const { id } = await b.kanbanCreateCard({ scope, statusId });
      await refresh();
      selectedId = id;
      // The drawer renders the title input only once the selection lands, so wait for
      // the DOM before focusing. Focus belongs here, not in an effect keyed on the
      // selection: every save refreshes the board, which would re-run the effect and
      // yank focus out of whichever field the user had moved on to.
      await tick();
      titleInput?.focus();
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

  // Dependency arrows. Hovering a card draws every predecessor→successor edge in the
  // chain it belongs to — not just the edges touching it — so one hover shows the whole
  // ordering the card sits in. Suppressed mid-drag, where the pointer sweeps over cards
  // it isn't asking about.
  let hoveredId = $state<string | null>(null);
  let boardEl = $state<HTMLElement | null>(null);
  let arrows = $state<string[]>([]);
  const arrowHead = $props.id(); // per-instance: several boards can be mounted at once

  const chainEdges = $derived.by(() => {
    if (!hoveredId || drag) return [];
    const byId = new Map(board.cards.map((c) => [c.id, c]));
    // The hovered card can go away under the pointer (deleted, or a board switch), and
    // no pointerleave fires when its element is simply removed.
    if (!byId.has(hoveredId)) return [];
    // Walk predecessor edges in both directions to collect the connected chain…
    const chain = new Set([hoveredId]);
    const stack = [hoveredId];
    while (stack.length) {
      const cur = byId.get(stack.pop()!)!;
      for (const n of [...cur.predecessors, ...cur.successors]) {
        if (byId.has(n) && !chain.has(n)) {
          chain.add(n);
          stack.push(n);
        }
      }
    }
    // …then read the edges back off it, each one exactly once (from its successor).
    const edges: { from: string; to: string }[] = [];
    for (const id of chain) {
      for (const p of byId.get(id)!.predecessors) if (chain.has(p)) edges.push({ from: p, to: id });
    }
    return edges;
  });

  type Box = { left: number; right: number; top: number; bottom: number };

  // Cards that overlap horizontally are in the same column (columns never overlap), so
  // they get a straight vertical line between the facing edges. Otherwise the arrow
  // leaves the source's side and enters the target's facing side, with the control
  // points half the horizontal gap out — far enough to meet each card square-on,
  // never so far that the curve doubles back between close columns.
  function arrowPath(a: Box, b: Box): string {
    if (b.left < a.right && b.right > a.left) {
      const x = (a.left + a.right) / 2;
      return b.top >= a.bottom ? `M${x} ${a.bottom} L${x} ${b.top}` : `M${x} ${a.top} L${x} ${b.bottom}`;
    }
    const rightward = b.left >= a.right;
    const [x1, x2] = rightward ? [a.right, b.left] : [a.left, b.right];
    const [y1, y2] = [(a.top + a.bottom) / 2, (b.top + b.bottom) / 2];
    const pull = (x2 - x1) / 2;
    return `M${x1} ${y1} C${x1 + pull} ${y1} ${x2 - pull} ${y2} ${x2} ${y2}`;
  }

  // The overlay is pinned to the visible board area while the columns scroll under it,
  // so the paths are remeasured on every scroll and resize as well as on hover.
  function measureArrows(): void {
    const host = boardEl;
    if (!host || chainEdges.length === 0) {
      arrows = [];
      return;
    }
    const o = host.getBoundingClientRect();
    const box = (id: string): Box | null => {
      const el = host.querySelector(`[data-card-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - o.left,
        right: r.right - o.left,
        top: r.top - o.top,
        bottom: r.bottom - o.top,
      };
    };
    const out: string[] = [];
    for (const e of chainEdges) {
      const from = box(e.from);
      const to = box(e.to);
      if (from && to) out.push(arrowPath(from, to));
    }
    arrows = out;
  }

  $effect(measureArrows);

  // Card detail drawer.
  let selectedId = $state<string | null>(null);
  const selected = $derived(board.cards.find((c) => c.id === selectedId) ?? null);
  let titleInput = $state<HTMLInputElement | null>(null);

  // Escape gives the selected card up. A field keeps the first Escape for itself — the
  // ones that revert already handle it, and leaving the field is what the key means
  // there — so from inside the drawer it takes two presses: out of the field, then off
  // the card. The modals own the key outright while they are open: the confirm dialog
  // dismisses on it and marks it handled, which is what `defaultPrevented` catches —
  // by the time this sees the event, the state that dialog was open for is already
  // cleared. The reason modal handles no keys, so its own state still has to be read.
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (selectedId === null || pending || pendingDelete) return;
    const el = e.target as HTMLElement | null;
    if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
      el.blur();
      return;
    }
    selectedId = null;
    // Cards are buttons, so clicking one also left it focused — closing the drawer but
    // leaving the ring behind would only half let go of it.
    if (el?.closest("[data-card-id]")) el.blur();
  }

  // Subtasks: a card's own checklist, not cards of their own. Every edit rewrites the
  // whole list through setMetadata (the board has no per-subtask operation), so all
  // four of these end the same way.
  function addSubtask(text: string): void {
    if (!selected) return;
    const t = text.trim();
    if (t === "") return;
    selected.subtasks = [...selected.subtasks, { text: t, done: false }];
    saveMetadata();
  }
  function toggleSubtask(i: number): void {
    if (!selected) return;
    selected.subtasks = selected.subtasks.map((s, n) => n === i ? { ...s, done: !s.done } : s);
    saveMetadata();
  }
  function removeSubtask(i: number): void {
    if (!selected) return;
    selected.subtasks = selected.subtasks.filter((_, n) => n !== i);
    saveMetadata();
  }
  // Committed on blur. An unchanged text saves nothing at all — leaving the row's
  // input in place, so a click heading for the ✕ next to it still lands.
  function renameSubtask(i: number, text: string): void {
    if (!selected) return;
    const t = text.trim();
    if (t === selected.subtasks[i].text) return;
    selected.subtasks = selected.subtasks.map((s, n) => n === i ? { ...s, text: t } : s);
    saveMetadata();
  }

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
        subtasks: selected.subtasks,
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

<svelte:window
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onresize={measureArrows}
  onkeydown={onKeydown}
/>

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
        >Workspace</button>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={showRoot}
          aria-pressed={showRoot}
          onclick={() => switchBoard(true)}
        >Root</button>
      </div>
    {/if}
  <div class="flex min-h-0 flex-1">
    <!-- Columns, under a pinned overlay for the dependency arrows: the wrapper doesn't
         scroll, so the arrows stay put while the board scrolls beneath them. -->
    <div
      class="relative min-h-0 min-w-0 flex-1"
      bind:this={boardEl}
      onscrollcapture={measureArrows}
    >
    <div class="flex h-full gap-3 overflow-x-auto p-3">
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
          <div class="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" data-cards>
            {#if dropAt && drag?.fromStatus === s.id}
              <div
                class="pointer-events-none absolute inset-x-2 h-0.5 rounded bg-primary"
                style="top: {dropAt.y}px"
              ></div>
            {/if}
            {#each cardsIn(s.id) as c (c.id)}
              <button
                type="button"
                class="cursor-grab touch-none select-none rounded border border-base-300 bg-base-100 p-2 text-left hover:border-primary"
                class:border-primary={selectedId === c.id}
                class:opacity-40={drag?.cardId === c.id}
                data-card-id={c.id}
                onpointerdown={(e) => onCardPointerDown(e, c.id, s.id)}
                onpointerenter={() => (hoveredId = c.id)}
                onpointerleave={() => { if (hoveredId === c.id) hoveredId = null; }}
              >
                <div
                  class="truncate text-sm"
                  class:italic={!c.title}
                  class:opacity-40={!c.title}
                >{c.title || "Untitled"}</div>
                <!-- Subtask progress leads the tag row: it is the card's own state, where
                     the tags are labels put on it. Outlined, so the two don't read alike. -->
                {#if c.subtasks.length > 0 || Object.keys(c.tags).length > 0}
                  <div class="mt-1 flex flex-wrap items-center gap-1">
                    {#if c.subtasks.length > 0}
                      <span class="badge badge-outline badge-xs">
                        ✓ {c.subtasks.filter((t) => t.done).length}/{c.subtasks.length}
                      </span>
                    {/if}
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

      {#if arrows.length > 0}
        <svg
          class="pointer-events-none absolute inset-0 h-full w-full overflow-hidden text-primary"
          aria-hidden="true"
        >
          <defs>
            <marker
              id={arrowHead}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
            </marker>
          </defs>
          {#each arrows as d, i (i)}
            <path {d} fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#{arrowHead})" />
          {/each}
        </svg>
      {/if}
    </div>

    <!-- Detail drawer -->
    {#if selected}
      <div class="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-base-300 bg-base-100 p-3">
        <div class="flex items-center justify-between">
          <span class="text-xs uppercase tracking-wide text-primary">Card</span>
          <button type="button" class="btn btn-square btn-ghost btn-xs" aria-label="Close card" onclick={() => (selectedId = null)}>✕</button>
        </div>

        <!-- Each label sits in a group with the control it names, so the 4px inside a
             group reads against the 12px between them — the label's ownership is in the
             spacing, not just the `for`. Same shape as the sections further down. -->
        <div class="flex flex-col gap-1">
          <label class="text-xs opacity-70" for="k-title">Title</label>
          <input id="k-title" class="input input-bordered input-sm" placeholder="Untitled" bind:this={titleInput} bind:value={selected.title} onblur={saveMetadata} />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs opacity-70" for="k-desc">Description</label>
          <textarea id="k-desc" class="textarea textarea-bordered textarea-sm" rows="4" bind:value={selected.description} onblur={saveMetadata}></textarea>
        </div>

        <!-- Subtasks: the card's checklist. Rows are edited in place — tick, retype, or
             remove — and the field at the bottom appends on Enter. -->
        <div class="flex flex-col gap-1">
          <div class="text-xs opacity-70">
            Subtasks
            {#if selected.subtasks.length > 0}
              <span class="opacity-60">· {selected.subtasks.filter((t) => t.done).length}/{selected.subtasks.length}</span>
            {/if}
          </div>
          {#each selected.subtasks as t, i (i)}
            <div class="flex items-center gap-1.5">
              <input
                type="checkbox"
                class="checkbox checkbox-xs shrink-0"
                aria-label="Done: {t.text}"
                checked={t.done}
                onchange={() => toggleSubtask(i)}
              />
              <input
                class="input input-bordered input-xs min-w-0 flex-1"
                class:line-through={t.done}
                class:opacity-50={t.done}
                aria-label="Subtask {i + 1}"
                value={t.text}
                onblur={(e) => {
                  // A blank row is not a subtask. Put the text back on the input itself:
                  // re-rendering from the board wouldn't, since the value Svelte holds
                  // for it never changed.
                  if (e.currentTarget.value.trim() === "") e.currentTarget.value = t.text;
                  else renameSubtask(i, e.currentTarget.value);
                }}
                onkeydown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") { e.currentTarget.value = t.text; e.currentTarget.blur(); }
                }}
              />
              <button
                type="button"
                class="btn btn-square btn-ghost btn-xs shrink-0"
                aria-label="Remove subtask {t.text}"
                onclick={() => removeSubtask(i)}
              >✕</button>
            </div>
          {/each}
          <input
            class="input input-bordered input-xs"
            aria-label="Add subtask"
            placeholder="+ Add subtask…"
            onkeydown={(e) => {
              if (e.key !== "Enter") return;
              addSubtask(e.currentTarget.value);
              e.currentTarget.value = "";
            }}
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs opacity-70" for="k-tags">Tags (<code>key: value</code> per line)</label>
          <textarea id="k-tags" class="textarea textarea-bordered textarea-sm font-mono" rows="3" bind:value={tagsText} onblur={() => { commitTags(); saveMetadata(); }}></textarea>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs opacity-70" for="k-artifacts">Artifacts (one per line)</label>
          <textarea id="k-artifacts" class="textarea textarea-bordered textarea-sm font-mono" rows="2" bind:value={artifactsText} onblur={() => { commitArtifacts(); saveConnections(); }}></textarea>
        </div>

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
                <option value={c.id}>{cardTitle.get(c.id)}</option>
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
      {cardTitle.get(drag.cardId) ?? "Untitled"}
    </div>
  {/if}

  <!-- Delete-a-non-empty-column confirmation -->
  <ConfirmDialog
    open={pendingDelete !== null}
    label="Delete"
    onconfirm={confirmDeleteColumn}
    oncancel={() => (pendingDelete = null)}
  >
    Delete <span class="font-medium">{pendingDelete!.name}</span>
    and its {pendingDelete!.count}
    {pendingDelete!.count === 1 ? "card" : "cards"}?
  </ConfirmDialog>

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
