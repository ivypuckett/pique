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

<div
  class="bg-base-300 transition-colors hover:bg-primary {axis === 'x'
    ? 'cursor-col-resize'
    : 'cursor-row-resize'}"
  class:bg-primary={dragging}
  role="separator"
  aria-orientation={axis === "x" ? "vertical" : "horizontal"}
  tabindex="-1"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
></div>
