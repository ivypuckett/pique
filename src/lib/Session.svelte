<script lang="ts">
  import { session } from "./store.ts";
  import Workspace from "./Workspace.svelte";
</script>

<!-- All workspaces stay mounted so backgrounded terminals keep running; only the selected
     one is shown. Same pattern Workspace.svelte uses for views, one level up. -->
<div class="relative min-h-0 flex-1">
  {#each $session.workspaces as w (w.id)}
    <div class="absolute inset-0" class:hidden={w.id !== $session.activeId}>
      <Workspace workspace={w} />
    </div>
  {/each}
</div>
