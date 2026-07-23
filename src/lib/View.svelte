<script lang="ts">
  import { resizeBoundary } from "./store.ts";
  import { fixedPx, gridTemplateColumns, type ViewState } from "./layout.ts";
  import Column from "./Column.svelte";
  import Splitter from "./Splitter.svelte";

  // cwd: the workspace's working-directory override, threaded down to modules so a
  // freshly spawned terminal/chat starts there. Undefined means "use the default".
  // workspaceId: the owning workspace's id, threaded down so a module can address
  // per-workspace state (e.g. the Kanban board DB).
  let { view, cwd, workspaceId }: { view: ViewState; cwd?: string; workspaceId?: string } =
    $props();

  let gridEl: HTMLDivElement;
  let centerEl: HTMLElement | undefined = $state();

  // The outer splitter sits between chat and the pane; chat is its visually-left column.
  function onDrag(clientX: number) {
    if (!centerEl || !gridEl) return;
    const flexPx = gridEl.clientWidth - fixedPx(view);
    if (flexPx <= 0) return;
    const newFirstPx = clientX - centerEl.getBoundingClientRect().left;
    resizeBoundary(view.id, "center-right", (newFirstPx / flexPx) * 100);
  }
</script>

<div
  class="grid h-full w-full grid-rows-1"
  style:grid-template-columns={gridTemplateColumns(view)}
  bind:this={gridEl}
>
  <Column viewId={view.id} col={view.center} id="center" {cwd} {workspaceId} bind:el={centerEl} />
  {#if !view.right.collapsed}
    <Splitter onDrag={onDrag} />
  {/if}
  <Column
    viewId={view.id}
    col={view.right}
    id="right"
    explorer={view.explorer}
    {cwd}
    {workspaceId}
  />
</div>
