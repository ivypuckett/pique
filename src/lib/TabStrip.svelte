<script lang="ts">
  import { addTab, closeTab, setActiveTab } from "./store.ts";
  import type { ColumnState } from "./layout.ts";
  import { MODULES } from "./modules/manifest.ts";

  let { viewId, col, explorerHidden, onToggleExplorer, onCollapse }: {
    viewId: string;
    col: ColumnState;
    explorerHidden?: boolean;
    onToggleExplorer?: () => void;
    onCollapse?: () => void;
  } = $props();
</script>

<div class="flex shrink-0 items-center gap-1 border-b border-base-300 bg-base-200 px-1 py-1">
  {#if onToggleExplorer}
    <button
      class="btn btn-ghost btn-xs"
      class:btn-active={!explorerHidden}
      aria-label="Toggle file explorer"
      aria-pressed={!explorerHidden}
      onclick={onToggleExplorer}
    >◧</button>
  {/if}
  {#each col.rows as tab (tab.id)}
    <div
      class="flex items-center gap-1 rounded-field px-2 py-0.5 text-sm"
      class:bg-base-100={tab.id === col.activeTabId}
      class:font-medium={tab.id === col.activeTabId}
      onauxclick={(e) => {
        if (e.button === 1) closeTab(viewId, tab.id);
      }}
    >
      <button class="truncate" onclick={() => setActiveTab(viewId, tab.id)}>{tab.title}</button>
      <button
        class="btn btn-ghost btn-xs px-1"
        aria-label="Close {tab.title} tab"
        onclick={() => closeTab(viewId, tab.id)}
      >×</button>
    </div>
  {/each}
  <div class="dropdown dropdown-end">
    <button tabindex="0" class="btn btn-ghost btn-xs" aria-label="Add tab">+</button>
    <ul class="dropdown-content menu z-10 mt-1 w-40 rounded-box bg-base-200 p-1 shadow">
      {#each MODULES as m (m.kind)}
        <li><button onclick={() => addTab(viewId, m.kind)}>{m.label}</button></li>
      {/each}
    </ul>
  </div>
  {#if onCollapse}
    <button
      class="btn btn-ghost btn-xs ml-auto"
      aria-label="Collapse right column"
      onclick={onCollapse}
    >«</button>
  {/if}
</div>
