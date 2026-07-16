<script lang="ts">
  import { resizeBoundary } from "./store.ts";
  import { type Boundary, fixedPx, gridTemplateColumns, type ViewState } from "./layout.ts";
  import Column from "./Column.svelte";
  import Splitter from "./Splitter.svelte";

  let { view }: { view: ViewState } = $props();

  let gridEl: HTMLDivElement;
  let leftEl: HTMLElement | undefined = $state();
  let centerEl: HTMLElement | undefined = $state();

  function onDrag(b: Boundary, clientX: number) {
    const firstEl = b === "left-center" ? leftEl : centerEl;
    if (!firstEl || !gridEl) return;
    const flexPx = gridEl.clientWidth - fixedPx(view);
    if (flexPx <= 0) return;
    const newFirstPx = clientX - firstEl.getBoundingClientRect().left;
    resizeBoundary(view.id, b, (newFirstPx / flexPx) * 100);
  }
</script>

<div
  class="grid h-full w-full"
  style:grid-template-columns={gridTemplateColumns(view)}
  bind:this={gridEl}
>
  <Column viewId={view.id} col={view.left} id="left" bind:el={leftEl} />
  {#if !view.left.collapsed}
    <Splitter onDrag={(x) => onDrag("left-center", x)} />
  {/if}
  <Column viewId={view.id} col={view.center} id="center" bind:el={centerEl} />
  {#if !view.right.collapsed}
    <Splitter onDrag={(x) => onDrag("center-right", x)} />
  {/if}
  <Column viewId={view.id} col={view.right} id="right" />
</div>
