<script lang="ts">
  import type { WorkspaceState } from "./workspace.ts";
  import View from "./View.svelte";

  let { workspace }: { workspace: WorkspaceState } = $props();
</script>

<!-- All views stay mounted so backgrounded terminals keep running; only the presented
     one is shown, full width. Switching (ctrl+h h/l) just changes which is visible. -->
<div class="relative h-full">
  {#each workspace.views as v (v.id)}
    <div class="absolute inset-0" class:hidden={v.id !== workspace.activeId}>
      <View view={v} cwd={workspace.cwd} workspaceId={workspace.id} />
    </div>
  {/each}
</div>
