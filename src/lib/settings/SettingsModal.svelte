<script lang="ts">
  import { settings, settingsOpen, THEMES } from "./store.ts";
  import { pickDirectory } from "./bindings.ts";
  import { extBindings, type ExtInfo, type ExtSearchResult } from "../chat/bindings.ts";

  async function browse(): Promise<void> {
    const dir = await pickDirectory($settings.workspace.defaultDir);
    if (dir) $settings.workspace.defaultDir = dir;
  }

  // Pi-extension management. Null in web-dev (no bindings) → the section shows a
  // desktop-only note. Extensions install into ~/.pique/agent, separate from `pi`.
  const ext = extBindings();
  let installed = $state<ExtInfo[]>([]);
  let source = $state("");
  let busy = $state(false);
  let extError = $state("");
  let extNotice = $state("");
  // Guards the install (extensions run arbitrary code): the source is only sent
  // after the user confirms this inline warning panel.
  let confirming = $state(false);

  // Browse: query pi packages via npm (see extensions.ts). A result's Install
  // routes through the same `confirming` gate as the manual source input.
  let query = $state("");
  let results = $state<ExtSearchResult[]>([]);
  let searching = $state(false);

  async function search(): Promise<void> {
    if (!ext) return;
    searching = true;
    extError = "";
    try {
      results = await ext.extSearch({ query: query.trim() });
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
    searching = false;
  }

  function installResult(r: ExtSearchResult): void {
    source = r.source;
    confirming = true;
  }

  async function refreshExts(): Promise<void> {
    if (!ext) return;
    try {
      installed = await ext.extList();
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
  }

  // Re-list whenever the modal opens; clear any stale notice/error from last time.
  $effect(() => {
    if ($settingsOpen && ext) {
      extError = "";
      extNotice = "";
      confirming = false;
      refreshExts();
    }
  });

  async function confirmInstall(): Promise<void> {
    confirming = false;
    if (!ext) return;
    busy = true;
    extError = "";
    extNotice = "";
    try {
      await ext.extInstall({ source: source.trim() });
      source = "";
      await refreshExts();
      extNotice = "Installed. Reopen your Chat modules to load it.";
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }

  async function removeExt(s: string): Promise<void> {
    if (!ext) return;
    busy = true;
    extError = "";
    extNotice = "";
    try {
      await ext.extRemove({ source: s });
      await refreshExts();
      extNotice = "Removed. Reopen your Chat modules to apply.";
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
    busy = false;
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

      <div class="mt-6 mb-3 text-xs uppercase tracking-wide text-primary">Extensions</div>
      {#if !ext}
        <div class="text-xs opacity-70">Available in the desktop app only.</div>
      {:else}
        <div class="mt-0.5 text-xs opacity-70">
          Pi extensions add tools and commands to Chat. Installed into pique only —
          separate from your <code>pi</code> CLI. Reopen Chat modules to load changes.
        </div>

        {#if installed.length > 0}
          <ul class="mt-3 max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
            {#each installed as e (e.source)}
              <li class="flex items-center justify-between gap-2 px-3 py-2">
                <span class="truncate font-mono text-xs" title={e.path ?? e.source}>{e.source}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  disabled={busy}
                  onclick={() => removeExt(e.source)}
                >Remove</button>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="mt-3 text-xs opacity-60">None installed.</div>
        {/if}

        <div class="mt-4 mb-2 text-xs opacity-70">Browse the pi package catalog (via npm):</div>
        <div class="flex gap-2">
          <input
            class="input input-bordered input-sm flex-1"
            placeholder="Search extensions…"
            aria-label="Search extensions"
            bind:value={query}
            disabled={busy || searching}
            onkeydown={(e) => e.key === "Enter" && search()}
          />
          <button type="button" class="btn btn-sm" disabled={busy || searching} onclick={search}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {#if results.length > 0}
          <ul class="mt-3 max-h-56 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
            {#each results as r (r.source)}
              <li class="flex items-start justify-between gap-2 px-3 py-2">
                <div class="min-w-0">
                  <div class="truncate font-mono text-xs" title={r.source}>{r.name}</div>
                  {#if r.description}
                    <div class="mt-0.5 line-clamp-2 text-xs opacity-70">{r.description}</div>
                  {/if}
                  <div class="mt-0.5 text-[0.65rem] opacity-50">
                    {#if r.author}{r.author} · {/if}{r.downloads.toLocaleString()}/mo
                  </div>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs shrink-0"
                  disabled={busy}
                  onclick={() => installResult(r)}
                >Install</button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if confirming}
          <div class="mt-3 rounded border border-warning/50 bg-warning/10 p-3">
            <div class="text-sm font-medium text-warning">Install this extension?</div>
            <div class="mt-1 break-all font-mono text-xs">{source.trim()}</div>
            <div class="mt-1.5 text-xs opacity-80">
              Extensions run with full system access. Only install sources you trust.
            </div>
            <div class="mt-2 flex gap-2">
              <button type="button" class="btn btn-warning btn-sm" onclick={confirmInstall}>Install</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick={() => (confirming = false)}>Cancel</button>
            </div>
          </div>
        {:else}
          <div class="mt-3 flex gap-2">
            <input
              class="input input-bordered input-sm flex-1 font-mono"
              placeholder="npm:@scope/pkg  ·  git:github.com/user/repo"
              aria-label="Extension source"
              bind:value={source}
              disabled={busy}
            />
            <button
              type="button"
              class="btn btn-sm"
              disabled={busy || source.trim() === ""}
              onclick={() => (confirming = true)}
            >Install</button>
          </div>
        {/if}

        {#if extNotice}<div class="mt-2 text-xs text-success">{extNotice}</div>{/if}
        {#if extError}<div class="mt-2 break-all text-xs text-error">{extError}</div>{/if}
      {/if}
    </div>
  </div>
  <button type="button" class="modal-backdrop" aria-label="Close settings" onclick={close}></button>
</div>
