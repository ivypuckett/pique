<script lang="ts">
  import { view, toggleCollapse, toggleRows } from "./store.ts";
  import type { ColumnId, SideId } from "./layout.ts";
  import ModuleFrame from "./ModuleFrame.svelte";
  import { registry } from "./modules/registry.ts";

  let { id, el = $bindable() }: { id: ColumnId; el?: HTMLElement } = $props();

  const col = $derived($view[id]);
  const isSide = id === "left" || id === "right";
  const sideId = id as SideId;
</script>

{#if col.collapsed}
  <div
    class="flex flex-col items-center gap-1 bg-base-200 pt-2"
    bind:this={el}
  >
    <button
      class="btn btn-ghost btn-xs"
      aria-label="Expand {id} column"
      onclick={() => toggleCollapse(sideId)}
    >»</button>
    <span class="mt-1 [writing-mode:vertical-rl] text-xs opacity-60">{col.rows[0].title}</span>
  </div>
{:else}
  <div
    class="grid h-full min-w-0"
    style:grid-template-rows={col.rows.length === 2 ? "1fr 1fr" : "1fr"}
    bind:this={el}
  >
    {#each col.rows as row, i (row.id)}
      {@const Module = registry[row.kind]}
      <div class="min-h-0">
        <ModuleFrame title={row.title}>
          {#snippet actions()}
            {#if isSide && i === 0}
              <button
                class="btn btn-ghost btn-xs"
                aria-label={col.rows.length === 2 ? "Remove second row" : "Add second row"}
                onclick={() => toggleRows(sideId)}
              >{col.rows.length === 2 ? "−" : "+"}</button>
              <button
                class="btn btn-ghost btn-xs"
                aria-label="Collapse {id} column"
                onclick={() => toggleCollapse(sideId)}
              >«</button>
            {/if}
          {/snippet}
          <Module title={row.title} />
        </ModuleFrame>
      </div>
    {/each}
  </div>
{/if}
