<script lang="ts">
  import { view, resizeBoundary } from "./store.ts";
  import { type Boundary, fixedPx, gridTemplateColumns } from "./layout.ts";
  import Column from "./Column.svelte";
  import Splitter from "./Splitter.svelte";

  let gridEl: HTMLDivElement;
  let leftEl: HTMLElement | undefined = $state();
  let centerEl: HTMLElement | undefined = $state();

  function onDrag(b: Boundary, clientX: number) {
    const firstEl = b === "left-center" ? leftEl : centerEl;
    if (!firstEl || !gridEl) return;
    const flexPx = gridEl.clientWidth - fixedPx($view);
    if (flexPx <= 0) return;
    const newFirstPx = clientX - firstEl.getBoundingClientRect().left;
    resizeBoundary(b, (newFirstPx / flexPx) * 100);
  }
</script>

<div
  class="grid h-full w-full"
  style:grid-template-columns={gridTemplateColumns($view)}
  bind:this={gridEl}
>
  <Column id="left" bind:el={leftEl} />
  {#if !$view.left.collapsed}
    <Splitter onDrag={(x) => onDrag("left-center", x)} />
  {/if}
  <Column id="center" bind:el={centerEl} />
  {#if !$view.right.collapsed}
    <Splitter onDrag={(x) => onDrag("center-right", x)} />
  {/if}
  <Column id="right" />
</div>
