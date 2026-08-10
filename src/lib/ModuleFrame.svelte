<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, actions, header = true, children }: {
    title: string;
    actions?: Snippet;
    header?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="m-1 flex h-full min-h-0 flex-col overflow-hidden rounded-box bg-base-100">
  {#if header}
    <header class="flex h-9 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
      <span class="truncate text-sm font-medium">{title}</span>
      <span class="flex items-center gap-1">{@render actions?.()}</span>
    </header>
  {/if}
  <!-- A module that throws while rendering takes its whole subtree down with it, so
       without a boundary the pane just empties — the only trace is an uncaught error in
       the devtools console. Show what broke instead, and offer a re-render: the usual
       cause is one bad row from a binding, and a retry after a refresh clears it. -->
  <div class="min-h-0 flex-1 overflow-auto p-3">
    <svelte:boundary onerror={(e) => console.error(`${title} module failed to render`, e)}>
      {@render children()}
      {#snippet failed(error, reset)}
        <div class="text-xs text-error">
          {title} failed to render: {error instanceof Error ? error.message : String(error)}
        </div>
        <button type="button" class="btn btn-ghost btn-xs mt-2" onclick={reset}>Try again</button>
      {/snippet}
    </svelte:boundary>
  </div>
</section>
