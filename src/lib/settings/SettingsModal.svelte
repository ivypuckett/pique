<script lang="ts">
  import { settings, settingsOpen, THEMES } from "./store.ts";

  // Bridge the boolean store to the native <dialog>: showModal()/close() are
  // imperative, so an effect drives them from settingsOpen, and the dialog's
  // own close event (Esc, backdrop) writes back to the store.
  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (!dialog) return;
    if ($settingsOpen && !dialog.open) dialog.showModal();
    else if (!$settingsOpen && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} class="modal" onclose={() => settingsOpen.set(false)}>
  <div class="modal-box max-w-lg overflow-hidden p-0">
    <div class="flex items-center justify-between border-b border-base-300 bg-base-200 px-4 py-3">
      <span class="text-base font-medium">Settings</span>
      <button
        class="btn btn-square btn-ghost btn-sm"
        aria-label="Close settings"
        onclick={() => settingsOpen.set(false)}
      >✕</button>
    </div>
    <div class="p-5">
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Appearance</div>
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm">Theme</div>
          <div class="mt-0.5 text-xs opacity-70">Applies to the whole app, including the terminal.</div>
        </div>
        <select
          class="select select-bordered select-sm min-w-44"
          aria-label="Theme"
          bind:value={$settings.appearance.theme}
        >
          {#each THEMES as t (t)}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button aria-label="Close settings">close</button>
  </form>
</dialog>
