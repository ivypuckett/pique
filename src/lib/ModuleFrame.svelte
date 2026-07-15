<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, actions, children }: {
    title: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="m-1 flex h-full min-h-0 flex-col overflow-hidden rounded-box border border-base-300 bg-base-100">
  <header class="flex h-9 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
    <span class="truncate text-sm font-medium">{title}</span>
    <span class="flex items-center gap-1">{@render actions?.()}</span>
  </header>
  <div class="min-h-0 flex-1 overflow-auto p-3">{@render children()}</div>
</section>
