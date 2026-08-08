<script lang="ts">
  import { resizeBoundary } from "./store.ts";
  import { gridTemplateColumns, SPLITTER_PX, type ViewState } from "./layout.ts";
  import { chPx } from "./ch.ts";
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
  // Chat is sized in ch, so the pointer's px are converted through one character's width.
  function onDrag(clientX: number) {
    if (!centerEl || !gridEl) return;
    const flexPx = gridEl.clientWidth - SPLITTER_PX;
    const ch = chPx(gridEl);
    if (flexPx <= 0 || ch <= 0) return;
    const left = centerEl.getBoundingClientRect().left;
    resizeBoundary(view.id, "center-right", (clientX - left) / ch, flexPx / ch);
  }
</script>

<div
  class="grid h-full w-full grid-rows-1"
  style:grid-template-columns={gridTemplateColumns(view)}
  bind:this={gridEl}
>
  <Column viewId={view.id} id="center" {cwd} {workspaceId} bind:el={centerEl} />
  <Splitter onDrag={onDrag} />
  <Column
    viewId={view.id}
    right={view.right}
    id="right"
    explorerWidthCh={view.explorerWidthCh}
    {cwd}
    {workspaceId}
  />
</div>
