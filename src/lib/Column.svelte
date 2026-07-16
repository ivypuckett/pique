<script lang="ts">
  import { resizeRow, toggleCollapse, toggleRows } from "./store.ts";
  import { type ColumnId, type ColumnState, type SideId, SPLITTER_PX } from "./layout.ts";
  import ModuleFrame from "./ModuleFrame.svelte";
  import Splitter from "./Splitter.svelte";
  import TabStrip from "./TabStrip.svelte";
  import { registry } from "./modules/registry.ts";

  let { viewId, col, id, el = $bindable() }: {
    viewId: string;
    col: ColumnState;
    id: ColumnId;
    el?: HTMLElement;
  } = $props();

  const isSide = $derived(id === "left" || id === "right");
  const sideId = $derived(id as SideId);

  function onRowDrag(clientY: number) {
    if (!el) return;
    const flexPx = el.clientHeight - SPLITTER_PX;
    if (flexPx <= 0) return;
    const firstPx = clientY - el.getBoundingClientRect().top;
    resizeRow(viewId, sideId, (firstPx / flexPx) * 100);
  }
</script>

{#if col.collapsed}
  <div
    class="flex flex-col items-center gap-1 bg-base-200 pt-2"
    bind:this={el}
  >
    <button
      class="btn btn-ghost btn-xs"
      aria-label="Expand {id} column"
      onclick={() => toggleCollapse(viewId, sideId)}
    >»</button>
    <span class="mt-1 [writing-mode:vertical-rl] text-xs opacity-60">{col.rows[0].title}</span>
  </div>
{:else if id === "center"}
  <div class="flex h-full min-w-0 flex-col" bind:this={el}>
    <TabStrip {viewId} {col} />
    <div class="relative min-h-0 flex-1">
      {#each col.rows as tab (tab.id)}
        {@const Module = registry[tab.kind]}
        <div class="absolute inset-0" class:hidden={tab.id !== col.activeTabId}>
          <ModuleFrame title={tab.title}>
            {#if Module}
              <Module title={tab.title} />
            {:else}
              <div class="text-sm opacity-60">
                Unknown module: <span class="font-mono">{tab.kind}</span>
              </div>
            {/if}
          </ModuleFrame>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div
    class="grid h-full min-w-0"
    style:grid-template-rows={col.rows.length === 2
      ? `${col.rowSplitPct}fr ${SPLITTER_PX}px ${100 - col.rowSplitPct}fr`
      : "1fr"}
    bind:this={el}
  >
    {#each col.rows as row, i (row.id)}
      {#if i === 1}
        <Splitter axis="y" onDrag={onRowDrag} />
      {/if}
      {@const Module = registry[row.kind]}
      <div class="min-h-0">
        <ModuleFrame title={row.title}>
          {#snippet actions()}
            {#if isSide && i === 0}
              <button
                class="btn btn-ghost btn-xs"
                aria-label={col.rows.length === 2 ? "Remove second row" : "Add second row"}
                onclick={() => toggleRows(viewId, sideId)}
              >{col.rows.length === 2 ? "−" : "+"}</button>
              <button
                class="btn btn-ghost btn-xs"
                aria-label="Collapse {id} column"
                onclick={() => toggleCollapse(viewId, sideId)}
              >«</button>
            {/if}
          {/snippet}
          {#if Module}
            <Module title={row.title} />
          {:else}
            <div class="text-sm opacity-60">
              Unknown module: <span class="font-mono">{row.kind}</span>
            </div>
          {/if}
        </ModuleFrame>
      </div>
    {/each}
  </div>
{/if}
