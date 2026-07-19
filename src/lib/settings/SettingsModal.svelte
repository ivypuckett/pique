<script lang="ts">
  import { settings, settingsOpen, THEMES } from "./store.ts";
  import { pickDirectory } from "./bindings.ts";

  async function browse(): Promise<void> {
    const dir = await pickDirectory($settings.workspace.defaultDir);
    if (dir) $settings.workspace.defaultDir = dir;
  }

  // settingsOpen is the single source of truth for visibility — a class-based
  // daisyui modal, not a native <dialog>. The native dialog's close/cancel
  // events proved unreliable in the target webview (Esc/backdrop closed the
  // element without firing the event, leaving the store stuck open and the
  // modal wedged shut), so every close path here writes the store directly.
  function close(): void {
    settingsOpen.set(false);
  }

  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={$settingsOpen ? onWindowKeydown : undefined} />

<div class="modal" class:modal-open={$settingsOpen} role="dialog" aria-modal="true" aria-label="Settings">
  <div class="modal-box max-w-lg overflow-hidden p-0">
    <div class="flex items-center justify-between border-b border-base-300 bg-base-200 px-4 py-3">
      <span class="text-base font-medium">Settings</span>
      <button
        class="btn btn-square btn-ghost btn-sm"
        aria-label="Close settings"
        onclick={close}
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

      <div class="mt-6 mb-3 text-xs uppercase tracking-wide text-primary">Workspace</div>
      <div>
        <div class="text-sm">Default working directory</div>
        <div class="mt-0.5 text-xs opacity-70">
          Where new terminals and chat agents start. Empty means your home directory.
          Applies to sessions opened after the change.
        </div>
        <div class="mt-2 flex gap-2">
          <input
            class="input input-bordered input-sm flex-1"
            placeholder="~"
            aria-label="Default working directory"
            bind:value={$settings.workspace.defaultDir}
          />
          <button type="button" class="btn btn-sm" onclick={browse}>Browse…</button>
        </div>
      </div>
    </div>
  </div>
  <button type="button" class="modal-backdrop" aria-label="Close settings" onclick={close}></button>
</div>
