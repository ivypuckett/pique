<script lang="ts">
  import { addTab, closeTab, setActiveTab } from "./store.ts";
  import { type ColumnState, moduleLabel } from "./layout.ts";
  import { registry } from "./modules/registry.ts";

  let { viewId, col }: { viewId: string; col: ColumnState } = $props();
  const kinds = Object.keys(registry);
</script>

<div class="flex shrink-0 items-center gap-1 border-b border-base-300 bg-base-200 px-1 py-1">
  {#each col.rows as tab (tab.id)}
    <div
      class="flex items-center gap-1 rounded-field px-2 py-0.5 text-sm"
      class:bg-base-100={tab.id === col.activeTabId}
      class:font-medium={tab.id === col.activeTabId}
    >
      <button class="truncate" onclick={() => setActiveTab(viewId, tab.id)}>{tab.title}</button>
      {#if col.rows.length > 1}
        <button
          class="btn btn-ghost btn-xs px-1"
          aria-label="Close {tab.title} tab"
          onclick={() => closeTab(viewId, tab.id)}
        >×</button>
      {/if}
    </div>
  {/each}
  <div class="dropdown dropdown-end">
    <button tabindex="0" class="btn btn-ghost btn-xs" aria-label="Add tab">+</button>
    <ul class="dropdown-content menu z-10 mt-1 w-40 rounded-box bg-base-200 p-1 shadow">
      {#each kinds as kind (kind)}
        <li><button onclick={() => addTab(viewId, kind)}>{moduleLabel(kind)}</button></li>
      {/each}
    </ul>
  </div>
</div>
