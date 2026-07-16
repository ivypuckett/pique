<script lang="ts">
  import { activeView, focusView, resetView, toggleCollapse, workspace } from "./store.ts";

  let { chordPending = false }: { chordPending?: boolean } = $props();
</script>

<header class="flex h-9 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
  <div class="flex items-center gap-3">
    <span class="text-sm font-semibold tracking-tight">pique</span>
    {#if $workspace.views.length > 1}
      <div class="flex items-center gap-1">
        {#each $workspace.views as v, i (v.id)}
          <button
            class="btn btn-ghost btn-xs px-2"
            class:btn-active={v.id === $workspace.activeId}
            aria-label="Switch to view {i + 1}"
            aria-pressed={v.id === $workspace.activeId}
            onclick={() => focusView(v.id)}
          >{i + 1}</button>
        {/each}
      </div>
    {/if}
  </div>
  {#if chordPending}
    <span class="font-mono text-xs opacity-60">ctrl+h — n·w·h·l</span>
  {/if}
  <div class="flex items-center gap-1">
    <button
      class="btn btn-ghost btn-sm"
      class:btn-active={!$activeView.left.collapsed}
      aria-label="Toggle left column"
      aria-pressed={!$activeView.left.collapsed}
      onclick={() => toggleCollapse($workspace.activeId, "left")}
    >◧</button>
    <button
      class="btn btn-ghost btn-sm"
      class:btn-active={!$activeView.right.collapsed}
      aria-label="Toggle right column"
      aria-pressed={!$activeView.right.collapsed}
      onclick={() => toggleCollapse($workspace.activeId, "right")}
    >◨</button>
    <button
      class="btn btn-ghost btn-sm"
      onclick={() => resetView($workspace.activeId)}
    >Reset</button>
  </div>
</header>
