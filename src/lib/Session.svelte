<script lang="ts">
  import { session, workspaces } from "./store.ts";
  import Workspace from "./Workspace.svelte";
</script>

<!-- All workspaces stay mounted so backgrounded terminals keep running; only the selected
     one is shown. Same pattern Workspace.svelte uses for views, one level up. Root is in
     this list like any other workspace — it renders and runs modules the same way. -->
<div class="relative min-h-0 flex-1">
  {#each $workspaces as w (w.id)}
    <div class="absolute inset-0" class:hidden={w.id !== $session.activeId}>
      <Workspace workspace={w} />
    </div>
  {/each}
</div>
