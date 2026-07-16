<script lang="ts">
  import { resetLayout, toggleCollapse, view } from "./store.ts";
</script>

<header class="flex h-9 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
  <span class="text-sm font-semibold tracking-tight">pique</span>
  <div class="flex items-center gap-1">
    <button
      class="btn btn-ghost btn-sm"
      class:btn-active={!$view.left.collapsed}
      aria-label="Toggle left column"
      aria-pressed={!$view.left.collapsed}
      onclick={() => toggleCollapse("left")}
    >◧</button>
    <button
      class="btn btn-ghost btn-sm"
      class:btn-active={!$view.right.collapsed}
      aria-label="Toggle right column"
      aria-pressed={!$view.right.collapsed}
      onclick={() => toggleCollapse("right")}
    >◨</button>
    <button
      class="btn btn-ghost btn-sm"
      onclick={() => resetLayout()}
    >Reset</button>
  </div>
</header>
