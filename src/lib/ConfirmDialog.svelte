<script lang="ts">
  import type { Snippet } from "svelte";

  // Shared confirmation modal: the question, a muted consequence line, cancel and a
  // destructive confirm. The caller owns the pending state — both callbacks are
  // expected to clear it — so this holds nothing of its own. Escape cancels, and the
  // confirm button takes focus on open so the dialog is answerable from the keyboard.
  let {
    open,
    label,
    note = "This can't be undone.",
    onconfirm,
    oncancel,
    children,
  }: {
    open: boolean;
    label: string; // confirm button text ("Delete", "Close")
    note?: string;
    onconfirm: () => void;
    oncancel: () => void;
    children: Snippet;
  } = $props();

  function takeFocus(node: HTMLElement) {
    node.focus();
  }
</script>

<div
  class="modal"
  class:modal-open={open}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onkeydown={(e) => {
    if (e.key !== "Escape") return;
    oncancel();
    e.preventDefault();
  }}
>
  <div class="modal-box max-w-sm">
    <!-- Contents exist only while open: the question reads off the pending item, and
         the confirm button's autofocus has to re-run each time the dialog appears. -->
    {#if open}
      <div class="text-sm">{@render children()}</div>
      <div class="mt-1 text-xs opacity-60">{note}</div>
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm" onclick={oncancel}>Cancel</button>
        <button type="button" class="btn btn-error btn-sm" use:takeFocus onclick={onconfirm}>
          {label}
        </button>
      </div>
    {/if}
  </div>
</div>
