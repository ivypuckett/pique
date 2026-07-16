<script lang="ts">
  import { focusWorkspace, session } from "./store.ts";
</script>

<!-- Fixed-width, full-height rail listing the session's workspaces. Always visible, even
     at one workspace: a rail that appeared and disappeared would reflow every terminal in
     the app. -->
<aside class="flex w-45 shrink-0 flex-col gap-1 border-r border-base-300 bg-base-200 p-2">
  <span class="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">
    Workspaces
  </span>
  {#each $session.workspaces as w (w.id)}
    <button
      class="btn btn-ghost btn-sm justify-start font-normal"
      class:btn-active={w.id === $session.activeId}
      aria-label="Switch to {w.title}"
      aria-pressed={w.id === $session.activeId}
      onclick={() => focusWorkspace(w.id)}
    >{w.title}</button>
  {/each}
</aside>
