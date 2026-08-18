<script lang="ts">
  import { settings, settingsOpen, ZOOM_LEVELS } from "./store.ts";
  import { providerBindings, type ProviderInfo } from "../chat/bindings.ts";
  import { openExternal } from "./bindings.ts";
  import {
    deleteTheme,
    duplicateCss,
    endPreview,
    previewTheme,
    saveTheme,
    themes,
  } from "./themes.ts";
  import { parseThemeCss } from "./theme_css.ts";

  // Same modifier glyph the status bar shows for the shortcuts it lists.
  const mod = navigator.userAgent.includes("Mac") ? "⌘" : "⌃";

  // Theme editing. A theme is edited as the CSS block daisyui's theme generator
  // exports, because that is exactly what it is (see theme_css.ts) — one pasted from
  // daisyui.com/theme-generator works unedited, and one edited here pastes back.
  // `editingName` is the theme being edited, or null for one that does not exist yet:
  // New, and Duplicate, which stays a draft until saved so backing out leaves nothing.
  let editing = $state(false);
  let editingName = $state<string | null>(null);
  let draft = $state("");
  let themeError = $state("");
  let copied = $state(false);
  let pendingDelete = $state(false);

  const active = $derived($settings.appearance.theme);

  // Where a pasteable theme comes from: its "CSS" export is exactly the format the
  // editor below reads and writes.
  const GENERATOR_URL = "https://daisyui.com/theme-generator";

  // Out to the real browser in the desktop app — pique's webview has no back button, so
  // following the link in place would strand the user in the theme generator. In web-dev
  // there is no backend to hand it to and the anchor's target="_blank" handles it.
  function openGenerator(e: MouseEvent): void {
    if (openExternal(GENERATOR_URL)) e.preventDefault();
  }

  function openEditor(name: string | null, css: string): void {
    editing = true;
    editingName = name;
    draft = css;
    themeError = "";
    pendingDelete = false;
  }

  function editActive(): void {
    const t = $themes.find((t) => t.name === active);
    if (t) openEditor(t.name, t.css);
  }

  function duplicateActive(): void {
    try {
      openEditor(null, duplicateCss($themes, active));
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    }
  }

  function saveDraft(): void {
    try {
      const next = saveTheme($themes, editingName, draft);
      const name = parseThemeCss(draft).name;
      themes.set(next);
      // A theme you just wrote is the one you want to be looking at — and the preview
      // already had it applied, so this is what makes that stick.
      settings.update((s) => ({ ...s, appearance: { ...s.appearance, theme: name } }));
      endPreview(name);
      editing = false;
      themeError = "";
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    }
  }

  function cancelEdit(): void {
    editing = false;
    themeError = "";
    endPreview(active);
  }

  function confirmDelete(): void {
    pendingDelete = false;
    try {
      // Dropping the active theme leaves data-theme naming nothing; the themes store
      // reconciles the setting to the first remaining theme (themes.ts).
      themes.set(deleteTheme($themes, active));
      themeError = "";
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    }
  }

  async function copyDraft(): Promise<void> {
    try {
      await navigator.clipboard.writeText(draft);
      copied = true;
      setTimeout(() => (copied = false), 1200);
    } catch {
      themeError = "clipboard unavailable — select the text and copy it";
    }
  }

  // Repaint the app from the draft on every keystroke that parses, so the theme is
  // edited against itself. A keystroke that does not parse shows the reason and leaves
  // the last good preview up — reverting mid-word would strobe the whole UI.
  $effect(() => {
    if (!editing) return;
    if (draft.trim() === "") {
      themeError = "";
      return;
    }
    try {
      previewTheme(parseThemeCss(draft));
      themeError = "";
    } catch (e) {
      themeError = e instanceof Error ? e.message : String(e);
    }
  });

  // The font fields commit on change — blur or Enter — and not on input, which is what
  // `bind:value` would have given. A keystroke is not a cheap write here: it repaints
  // the app off the new --font-sans/--font-mono, and every open terminal re-measures its
  // cell and tells its pty the new size (terminal/Terminal.svelte), so typing a family
  // name ran that per character and per tab. Nothing about the value is worth applying
  // half-typed anyway — "JetBrains Mo" is not a font.
  function commitFont(field: "uiFont" | "monoFont", value: string): void {
    settings.update((s) => ({
      ...s,
      appearance: { ...s.appearance, [field]: value },
    }));
  }

  // Model providers. Null in web-dev (no bindings) → the section shows a
  // desktop-only note. Connections are shared with the `pi` CLI (see providers.ts).
  const prov = providerBindings();
  let providers = $state<ProviderInfo[]>([]);
  let provError = $state("");
  let provBusy = $state(false);
  // Per-provider API-key drafts, keyed by provider id (only the unconnected rows).
  let keyInputs = $state<Record<string, string>>({});
  // Custom-endpoint form.
  let showCustom = $state(false);
  let cId = $state("");
  let cBaseUrl = $state("");
  let cKey = $state("");
  let cModels = $state("");

  async function refreshProviders(): Promise<void> {
    if (!prov) return;
    try {
      providers = await prov.providerList();
    } catch (e) {
      provError = e instanceof Error ? e.message : String(e);
    }
  }

  async function connectProvider(id: string): Promise<void> {
    if (!prov) return;
    const apiKey = (keyInputs[id] ?? "").trim();
    if (apiKey === "") return;
    provBusy = true;
    provError = "";
    try {
      await prov.providerConnect({ id, apiKey });
      keyInputs[id] = "";
      await refreshProviders();
    } catch (e) {
      provError = e instanceof Error ? e.message : String(e);
    }
    provBusy = false;
  }

  async function disconnectProvider(id: string): Promise<void> {
    if (!prov) return;
    provBusy = true;
    provError = "";
    try {
      await prov.providerDisconnect({ id });
      await refreshProviders();
    } catch (e) {
      provError = e instanceof Error ? e.message : String(e);
    }
    provBusy = false;
  }

  async function addCustomProvider(): Promise<void> {
    if (!prov) return;
    const models = cModels.split(/[\n,]/).map((m) => m.trim()).filter((m) => m !== "");
    provBusy = true;
    provError = "";
    try {
      await prov.providerAddCustom({
        id: cId.trim(),
        baseUrl: cBaseUrl.trim(),
        apiKey: cKey.trim() || undefined,
        models,
      });
      cId = cBaseUrl = cKey = cModels = "";
      showCustom = false;
      await refreshProviders();
    } catch (e) {
      provError = e instanceof Error ? e.message : String(e);
    }
    provBusy = false;
  }

  async function removeCustomProvider(id: string): Promise<void> {
    if (!prov) return;
    provBusy = true;
    provError = "";
    try {
      await prov.providerRemoveCustom({ id });
      await refreshProviders();
    } catch (e) {
      provError = e instanceof Error ? e.message : String(e);
    }
    provBusy = false;
  }

  // Re-list providers whenever the modal opens; clear any stale error/form state.
  $effect(() => {
    if ($settingsOpen && prov) {
      provError = "";
      showCustom = false;
      refreshProviders();
    }
  });

  // settingsOpen is the single source of truth for visibility — a class-based
  // daisyui modal, not a native <dialog>. The native dialog's close/cancel
  // events proved unreliable in the target webview (Esc/backdrop closed the
  // element without firing the event, leaving the store stuck open and the
  // modal wedged shut), so every close path here writes the store directly.
  function close(): void {
    // An open editor is previewing its draft onto the whole app; closing out from under
    // it would leave the app wearing a theme that was never saved.
    if (editing) cancelEdit();
    settingsOpen.set(false);
  }

  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  // Side-pane navigation: one entry per settings header.
  const SECTIONS = [
    { id: "appearance", label: "Appearance" },
    { id: "workspace", label: "Workspace" },
    { id: "providers", label: "Providers" },
  ] as const;
  let section = $state<(typeof SECTIONS)[number]["id"]>("appearance");
</script>

<svelte:window onkeydown={$settingsOpen ? onWindowKeydown : undefined} />

<div class="modal" class:modal-open={$settingsOpen} role="dialog" aria-modal="true" aria-label="Settings">
  <div class="modal-box flex max-h-[80vh] min-h-[22rem] max-w-3xl flex-col overflow-hidden p-0">
    <div class="flex shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-4 py-3">
      <span class="text-base font-medium">Settings</span>
      <button
        class="btn btn-square btn-ghost btn-sm"
        aria-label="Close settings"
        onclick={close}
      >✕</button>
    </div>
    <div class="flex min-h-0 flex-1">
      <nav class="w-44 shrink-0 overflow-y-auto border-r border-base-300 bg-base-200 p-2" aria-label="Settings sections">
        <ul class="menu menu-sm w-full gap-0.5">
          {#each SECTIONS as s (s.id)}
            <li>
              <button
                type="button"
                class:menu-active={section === s.id}
                aria-current={section === s.id ? "page" : undefined}
                onclick={() => (section = s.id)}
              >{s.label}</button>
            </li>
          {/each}
        </ul>
      </nav>
      <div class="min-w-0 flex-1 overflow-y-auto p-5">
      {#if section === "appearance"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Appearance</div>
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm">Theme</div>
          <div class="mt-0.5 text-xs opacity-70">Applies to the whole app, including the terminal.</div>
        </div>
        <select
          class="select select-bordered select-sm min-w-44"
          aria-label="Theme"
          disabled={editing}
          bind:value={$settings.appearance.theme}
        >
          {#each $themes as t (t.name)}
            <option value={t.name}>{t.name}</option>
          {/each}
        </select>
      </div>

      {#if !editing}
        <div class="mt-2 flex justify-end gap-2">
          {#if pendingDelete}
            <span class="self-center text-xs opacity-70">Delete “{active}”?</span>
            <button type="button" class="btn btn-error btn-xs" onclick={confirmDelete}>Delete</button>
            <button type="button" class="btn btn-ghost btn-xs" onclick={() => (pendingDelete = false)}
            >Cancel</button>
          {:else}
            <button type="button" class="btn btn-xs" onclick={editActive}>Edit</button>
            <button type="button" class="btn btn-xs" onclick={duplicateActive}>Duplicate</button>
            <button type="button" class="btn btn-xs" onclick={() => openEditor(null, "")}>New</button>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={$themes.length <= 1}
              onclick={() => (pendingDelete = true)}
            >Delete</button>
          {/if}
        </div>
      {:else}
        <div class="mt-3 rounded border border-base-300 p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="text-sm font-medium">
              {editingName === null ? "New theme" : `Editing “${editingName}”`}
            </div>
            <button type="button" class="btn btn-ghost btn-xs" onclick={copyDraft}>
              {copied ? "Copied" : "Copy CSS"}
            </button>
          </div>
          <div class="mt-0.5 text-xs opacity-70">
            Paste the CSS export from
            <a
              class="link"
              href={GENERATOR_URL}
              target="_blank"
              rel="noreferrer"
              onclick={openGenerator}
            >daisyui's theme generator</a>, or edit this one. Changes preview live;
            nothing is saved until you press Save.
          </div>
          <textarea
            class="textarea textarea-bordered mt-2 w-full font-mono text-xs leading-snug"
            rows="16"
            spellcheck="false"
            aria-label="Theme CSS"
            placeholder={'@plugin "daisyui/theme" {\n  name: "my-theme";\n  color-scheme: "dark";\n  --color-base-100: oklch(25% 0.016 252);\n  …\n}'}
            bind:value={draft}
          ></textarea>
          <div class="mt-2 flex items-center gap-2">
            <button type="button" class="btn btn-sm" disabled={draft.trim() === ""} onclick={saveDraft}
            >Save</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick={cancelEdit}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if themeError}<div class="mt-2 text-xs text-error">{themeError}</div>{/if}

      <!-- Free text, and no picker of installed families: the value is a CSS
           font-family, so what is worth writing here is a stack with fallbacks, which no
           list of single families can offer. Enumerating them would also have meant a
           backend — the webview has no queryLocalFonts() — and the only cross-platform
           way to do that is guessing at names, which is worse than typing one. Each
           field is rendered IN the family it sets, so a name that resolves to nothing
           shows itself as unchanged text. -->
      <div class="mt-4">
        <div class="text-sm">Interface font</div>
        <div class="mt-0.5 text-xs opacity-70">
          A CSS font-family value for the app's text — one family, or several to fall
          through. Empty uses the built-in stack.
        </div>
        <input
          class="input input-bordered input-sm mt-2 w-full font-sans"
          placeholder="Inter, system-ui, sans-serif"
          spellcheck="false"
          aria-label="Interface font"
          value={$settings.appearance.uiFont}
          onchange={(e) => commitFont("uiFont", e.currentTarget.value)}
        />
      </div>

      <div class="mt-4">
        <div class="text-sm">Monospace font</div>
        <div class="mt-0.5 text-xs opacity-70">
          Used by the terminal, diffs, and anything else showing code or paths.
        </div>
        <input
          class="input input-bordered input-sm mt-2 w-full font-mono"
          placeholder="Azeret Mono, monospace"
          spellcheck="false"
          aria-label="Monospace font"
          value={$settings.appearance.monoFont}
          onchange={(e) => commitFont("monoFont", e.currentTarget.value)}
        />
      </div>

      <div class="mt-4 flex items-center justify-between gap-4">
        <div>
          <div class="text-sm">Zoom</div>
          <div class="mt-0.5 text-xs opacity-70">
            Scales the whole interface. <kbd class="kbd kbd-xs">{mod}=</kbd>
            and <kbd class="kbd kbd-xs">{mod}-</kbd> step it,
            <kbd class="kbd kbd-xs">{mod}0</kbd> returns to 100%.
          </div>
        </div>
        <select
          class="select select-bordered select-sm min-w-44"
          aria-label="Zoom"
          bind:value={$settings.appearance.zoom}
        >
          {#each ZOOM_LEVELS as z (z)}
            <option value={z}>{Math.round(z * 100)}%</option>
          {/each}
        </select>
      </div>

      {/if}

      {#if section === "workspace"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Workspace</div>
      <div>
        <div class="text-sm">Default working directory</div>
        <div class="mt-0.5 text-xs opacity-70">
          Set per workspace from the path button in the top bar. The Root workspace's
          directory is the default every other workspace falls back to when it has
          none of its own; empty means your home directory.
        </div>
      </div>

      <div class="mt-4">
        <div class="text-sm">Git highlight scan depth</div>
        <div class="mt-0.5 text-xs opacity-70">
          When the working directory isn't itself a git repo, how many folder levels to
          descend looking for the repos inside, so folders with changes get highlighted.
          0 disables the scan. Applies to file trees opened after the change.
        </div>
        <div class="mt-2">
          <input
            class="input input-bordered input-sm w-24"
            type="number"
            min="0"
            max="10"
            aria-label="Git highlight scan depth"
            bind:value={$settings.workspace.gitScanDepth}
          />
        </div>
      </div>

      <div class="mt-4">
        <label class="flex items-center gap-2 text-sm">
          <input
            class="checkbox checkbox-sm"
            type="checkbox"
            bind:checked={$settings.workspace.confirmDelete}
          />
          Confirm before deleting in the file tree
        </label>
        <div class="mt-0.5 text-xs opacity-70">
          Deletes are permanent, and a folder takes everything under it. With this off,
          <kbd class="kbd kbd-xs">d</kbd>
          <kbd class="kbd kbd-xs">d</kbd>
          removes the highlighted entry immediately.
        </div>
      </div>

      {/if}

      {#if section === "providers"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Providers</div>
      {#if !prov}
        <div class="text-xs opacity-70">Available in the desktop app only.</div>
      {:else}
        <div class="mt-0.5 text-xs opacity-70">
          Connect any model provider. API keys unlock the built-in providers; add a custom
          endpoint for an OpenAI-compatible server (LM Studio, Ollama, …). Shared with your
          <code>pi</code> CLI. Reopen Chat modules to pick newly available models.
        </div>

        {#if providers.length > 0}
          <ul class="mt-3 max-h-72 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
            {#each providers as p (p.id)}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <span class="font-mono text-xs">{p.name}</span>
                    {#if p.isCustom}<span class="badge badge-ghost badge-xs ml-1.5 align-middle">custom</span>{/if}
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    {#if p.configured}
                      <span class="text-xs text-success">Connected</span>
                    {:else}
                      <span class="text-xs opacity-50">Not connected</span>
                    {/if}
                    {#if p.isCustom}
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        disabled={provBusy}
                        onclick={() => removeCustomProvider(p.id)}
                      >Remove</button>
                    {:else if p.configured && p.canApiKey}
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        disabled={provBusy}
                        onclick={() => disconnectProvider(p.id)}
                      >Disconnect</button>
                    {/if}
                  </div>
                </div>
                {#if !p.configured && p.canApiKey}
                  <div class="mt-2 flex gap-2">
                    <input
                      class="input input-bordered input-xs flex-1 font-mono"
                      type="password"
                      placeholder="API key"
                      aria-label={`${p.name} API key`}
                      bind:value={keyInputs[p.id]}
                      disabled={provBusy}
                      onkeydown={(e) => e.key === "Enter" && connectProvider(p.id)}
                    />
                    <button
                      type="button"
                      class="btn btn-xs"
                      disabled={provBusy || (keyInputs[p.id] ?? "").trim() === ""}
                      onclick={() => connectProvider(p.id)}
                    >Connect</button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if showCustom}
          <div class="mt-3 rounded border border-base-300 p-3">
            <div class="text-sm font-medium">Custom endpoint</div>
            <div class="mt-2 grid gap-2">
              <input
                class="input input-bordered input-sm font-mono"
                placeholder="id  ·  e.g. lmstudio"
                aria-label="Provider id"
                bind:value={cId}
                disabled={provBusy}
              />
              <input
                class="input input-bordered input-sm font-mono"
                placeholder="base URL  ·  http://localhost:1234/v1"
                aria-label="Base URL"
                bind:value={cBaseUrl}
                disabled={provBusy}
              />
              <input
                class="input input-bordered input-sm font-mono"
                type="password"
                placeholder="API key (optional)"
                aria-label="Custom endpoint API key"
                bind:value={cKey}
                disabled={provBusy}
              />
              <textarea
                class="textarea textarea-bordered textarea-sm font-mono"
                rows="3"
                placeholder="model ids, one per line"
                aria-label="Model ids"
                bind:value={cModels}
                disabled={provBusy}
              ></textarea>
            </div>
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                class="btn btn-sm"
                disabled={provBusy || cId.trim() === "" || cBaseUrl.trim() === "" || cModels.trim() === ""}
                onclick={addCustomProvider}
              >Add</button>
              <button type="button" class="btn btn-ghost btn-sm" disabled={provBusy} onclick={() => (showCustom = false)}
              >Cancel</button>
            </div>
          </div>
        {:else}
          <button type="button" class="btn btn-sm mt-3" disabled={provBusy} onclick={() => (showCustom = true)}
          >Add custom endpoint…</button>
        {/if}

        {#if provError}<div class="mt-2 break-all text-xs text-error">{provError}</div>{/if}
      {/if}

      {/if}

      </div>
    </div>
  </div>
  <button type="button" class="modal-backdrop" aria-label="Close settings" onclick={close}></button>
</div>
