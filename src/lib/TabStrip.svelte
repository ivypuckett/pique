<script lang="ts">
  import { closeTab, newTab, setActiveTab } from "./store.ts";
  import { moduleLabel, type RightState } from "./layout.ts";
  import { hasTabs, isDuplicable } from "./modules/manifest.ts";

  let { viewId, right }: { viewId: string; right: RightState } = $props();

  // The strip is the selected group's tabs only — the other groups stay open behind it. A
  // singleton row has none: it is its module, which the bar's label already names. The bar
  // itself stays either way, so the content below it doesn't shift as you move between rows.
  const tabs = $derived(
    hasTabs(right.activeGroup)
      ? right.tabs.filter((t) => t.group === right.activeGroup)
      : [],
  );
  const shown = $derived(right.activeTabs[right.activeGroup] ?? "");
</script>

<!-- Fixed height, not padding around whatever is inside: a singleton row has no chips, and
     a bar that shrank to fit its contents would shift the module below it by a few pixels
     every time you moved between rows. -->
<div class="flex h-9 shrink-0 items-center gap-1 border-b border-base-300 bg-base-200 px-1">
  <!-- The selected row, named. The rail says the same thing, but it is hideable (ctrl+shift+b)
       and this bar is not, so with the rail away this is what tells you where you are. -->
  <span class="px-2 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">
    {moduleLabel(right.activeGroup)}
  </span>
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
</div>
