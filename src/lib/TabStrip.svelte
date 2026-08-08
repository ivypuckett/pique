<script lang="ts">
  import { closeTab, newTab, setActiveTab } from "./store.ts";
  import { moduleLabel, type RightState } from "./layout.ts";
  import { isDuplicable } from "./modules/manifest.ts";

  let { viewId, right, onCollapse }: {
    viewId: string;
    right: RightState;
    onCollapse?: () => void;
  } = $props();

  // The strip is the selected group's tabs only — the other groups stay open behind it.
  const tabs = $derived(right.tabs.filter((t) => t.group === right.activeGroup));
  const shown = $derived(right.activeTabs[right.activeGroup] ?? "");
</script>

<div class="flex shrink-0 items-center gap-1 border-b border-base-300 bg-base-200 px-1 py-1">
  {#each tabs as tab (tab.id)}
    <div
      class="flex items-center gap-1 rounded-field px-2 py-0.5 text-sm"
      class:bg-base-100={tab.id === shown}
      class:font-medium={tab.id === shown}
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
  <!-- Which module to open is the rail's job now, so + means one more of this one. Only a
       duplicable row can have a second, so it is the only row that shows the button. -->
  {#if isDuplicable(right.activeGroup)}
    <button
      class="btn btn-ghost btn-xs"
      aria-label="New {moduleLabel(right.activeGroup)} tab"
      onclick={() => newTab(viewId)}
    >+</button>
  {/if}
  {#if onCollapse}
    <button
      class="btn btn-ghost btn-xs ml-auto"
      aria-label="Collapse right column"
      onclick={onCollapse}
    >«</button>
  {/if}
</div>
