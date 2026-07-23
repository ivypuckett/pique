<script lang="ts">
  // axis "x": vertical divider between columns, dragged horizontally (reports clientX).
  // axis "y": horizontal divider between rows, dragged vertically (reports clientY).
  let { axis = "x", onDrag }: { axis?: "x" | "y"; onDrag: (client: number) => void } =
    $props();
  let dragging = $state(false);

  function down(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (dragging) onDrag(axis === "x" ? e.clientX : e.clientY);
  }
  function up(e: PointerEvent) {
    dragging = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }
</script>

<!-- The track is a transparent drag hit-area (SPLITTER_PX wide); the visible divider is a
     1px line centred in it, matching the static workspace-rail border (border-base-300). -->
<div
  class="group relative {axis === 'x' ? 'cursor-col-resize' : 'cursor-row-resize'}"
  role="separator"
  aria-orientation={axis === "x" ? "vertical" : "horizontal"}
  tabindex="-1"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  <div
    class="pointer-events-none absolute bg-base-300 transition-colors group-hover:bg-primary {axis ===
    'x'
      ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
      : 'inset-x-0 top-1/2 h-px -translate-y-1/2'}"
    class:bg-primary={dragging}
  ></div>
</div>
