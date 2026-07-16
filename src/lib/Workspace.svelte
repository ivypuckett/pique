<script lang="ts">
  import { workspace } from "./store.ts";
  import View from "./View.svelte";
</script>

<!-- All views stay mounted so backgrounded terminals keep running; only the presented
     one is shown, full width. Switching (ctrl+h h/l) just changes which is visible. -->
<div class="relative min-h-0 flex-1">
  {#each $workspace.views as v (v.id)}
    <div class="absolute inset-0" class:hidden={v.id !== $workspace.activeId}>
      <View view={v} />
    </div>
  {/each}
</div>
