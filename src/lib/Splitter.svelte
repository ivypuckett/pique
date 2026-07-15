<script lang="ts">
  let { onDrag }: { onDrag: (clientX: number) => void } = $props();
  let dragging = $state(false);

  function down(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (dragging) onDrag(e.clientX);
  }
  function up(e: PointerEvent) {
    dragging = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }
</script>

<div
  class="cursor-col-resize bg-base-300 transition-colors hover:bg-primary"
  class:bg-primary={dragging}
  role="separator"
  aria-orientation="vertical"
  tabindex="-1"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
></div>
