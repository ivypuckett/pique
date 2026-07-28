<script lang="ts">
  import { settings, settingsOpen, THEMES } from "./store.ts";
  import {
    extBindings,
    type ExtInfo,
    type ExtSearchResult,
    providerBindings,
    type ProviderInfo,
  } from "../chat/bindings.ts";
  import { type DefinedTool, toolBindings } from "../tools/bindings.ts";
  import { editing, editScope, updateScopeConfig } from "../scope/store.ts";
  import { ROOT } from "../scope/paths.ts";
  import { activeWorkspace } from "../store.ts";

  // Which scope the scoped sections (Kanban, Extensions, Tools) act on. Root is the
  // shared parent; the active workspace is the only other scope reachable from here,
  // because a workspace can never configure a sibling.
  const scopes = $derived(
    $activeWorkspace.id === ROOT
      ? [{ id: ROOT, label: "Root" }]
      : [{ id: ROOT, label: "Root (shared)" }, { id: $activeWorkspace.id, label: $activeWorkspace.title }],
  );
  const scope = $derived($editing.scope);
  const inRoot = $derived(scope === ROOT);

  // Statuses of the scope being edited, falling back to root's compiled-in list only
  // for display — an unset value means "inherit", so the list is only written when
  // the user actually edits it.
  const statuses = $derived($editing.config.kanban?.defaultStatuses ?? []);

  // Pi-extension management. Null in web-dev (no bindings) → the section shows a
  // desktop-only note. Extensions install into the selected scope's agent dir.
  const ext = extBindings();
  let installed = $state<ExtInfo[]>([]);
  let source = $state("");
  let busy = $state(false);
  let extError = $state("");
  let extNotice = $state("");
  // Guards the install (extensions run arbitrary code): the source is only sent
  // after the user confirms this inline warning panel.
  let confirming = $state(false);

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
      installed = await ext.extList({ scope });
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
  }

  // Point the modal at the active workspace's scope each time it opens, so the
  // sections describe where the user actually is rather than wherever they last
  // browsed. Root is its own scope and stays selected there.
  $effect(() => {
    if ($settingsOpen) editScope($activeWorkspace.id);
  });

  // Re-list whenever the modal opens OR the scope changes — both change what these
  // lists should show. Clears any stale notice/error from the previous scope.
  $effect(() => {
    if ($settingsOpen && ext && scope) {
      extError = "";
      extNotice = "";
      confirming = false;
      refreshExts();
    }
  });

  // Re-list providers whenever the modal opens; clear any stale error/form state.
  $effect(() => {
    if ($settingsOpen && prov) {
      provError = "";
      showCustom = false;
      refreshProviders();
    }
  });

  async function confirmInstall(): Promise<void> {
    confirming = false;
    if (!ext) return;
    busy = true;
    extError = "";
    extNotice = "";
    try {
      await ext.extInstall({ scope, source: source.trim() });
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
      await ext.extRemove({ scope, source: s });
      await refreshExts();
      extNotice = "Removed. Reopen your Chat modules to apply.";
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }

  // Defined tools — pi extensions written by the user or by an agent (define_tool).
  // Agent-written source sits in a quarantine dir that pi never loads; approving is
  // what moves it into the auto-discovered dir (see tools/paths.ts). Null in
  // web-dev, same desktop-only note as extensions/providers.
  const tools = toolBindings();
  let defined = $state<DefinedTool[]>([]);
  let toolError = $state("");
  let toolNotice = $state("");
  let toolBusy = $state(false);
  // The tool whose source is currently expanded for review, and its source text.
  // Reviewing is deliberately required before Approve: the source IS the artifact.
  let reviewing = $state<string | null>(null);
  let reviewSource = $state("");

  // `defined` is every tool visible from the selected scope — its own plus root's.
  // They are split by owner, because only a scope's OWN tools can be approved or
  // revoked here; inherited ones are managed where they live.
  const ownPending = $derived(defined.filter((t) => t.state === "pending" && t.scope === scope));
  const ownApproved = $derived(defined.filter((t) => t.state === "approved" && t.scope === scope));
  const inheritedTools = $derived(defined.filter((t) => t.scope !== scope));

  async function refreshTools(): Promise<void> {
    if (!tools) return;
    try {
      defined = await tools.toolsVisible({ scope });
    } catch (e) {
      toolError = e instanceof Error ? e.message : String(e);
    }
  }

  // Re-list whenever the modal opens or the scope changes; collapse any open review.
  $effect(() => {
    if ($settingsOpen && tools && scope) {
      toolError = "";
      toolNotice = "";
      reviewing = null;
      refreshTools();
    }
  });

  // Keyed by scope AND name: the same tool name can exist in root and in a workspace,
  // and expanding one must not expand the other.
  function toolKey(t: DefinedTool): string {
    return `${t.scope}/${t.name}`;
  }

  async function review(t: DefinedTool): Promise<void> {
    if (!tools) return;
    if (reviewing === toolKey(t)) {
      reviewing = null;
      return;
    }
    toolError = "";
    try {
      reviewSource = (await tools.toolsRead({ scope: t.scope, name: t.name, state: t.state })).source;
      reviewing = toolKey(t);
    } catch (e) {
      toolError = e instanceof Error ? e.message : String(e);
    }
  }

  // The three mutations share a shape: run, re-list, report. `notice` is what the
  // user sees on success — each spells out when the change actually takes effect.
  async function toolAction(
    run: () => Promise<unknown>,
    notice: string,
  ): Promise<void> {
    toolBusy = true;
    toolError = "";
    toolNotice = "";
    try {
      await run();
      reviewing = null;
      await refreshTools();
      toolNotice = notice;
    } catch (e) {
      toolError = e instanceof Error ? e.message : String(e);
    }
    toolBusy = false;
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

  // Side-pane navigation: one entry per settings header. The right pane shows
  // only the selected section, so the modal stops spilling over vertically.
  const SECTIONS = [
    { id: "appearance", label: "Appearance" },
    { id: "workspace", label: "Workspace" },
    { id: "kanban", label: "Kanban" },
    { id: "providers", label: "Providers" },
    { id: "extensions", label: "Extensions" },
    { id: "tools", label: "Tools" },
  ] as const;
  let section = $state<(typeof SECTIONS)[number]["id"]>("appearance");

  // Sections whose content belongs to a scope rather than the app. Appearance and
  // Workspace are app-wide; Providers are shared with the `pi` CLI machine-wide.
  const SCOPED_SECTIONS: readonly string[] = ["kanban", "extensions", "tools"];

  // Default statuses seeded into a new board in the selected scope (kanban/board.ts).
  // Seed only — an existing board's columns are edited on the board (Kanban.svelte).
  // Every edit writes the whole list, which is also what stops the scope inheriting root's.
  function setStatuses(next: { name: string }[]): void {
    updateScopeConfig((c) => ({ ...c, kanban: { ...c.kanban, defaultStatuses: next } }));
  }
  function addStatus(): void {
    setStatuses([...statuses, { name: "New status" }]);
  }
  function removeStatus(i: number): void {
    setStatuses(statuses.filter((_, j) => j !== i));
  }
  function renameStatus(i: number, name: string): void {
    setStatuses(statuses.map((s, j) => (j === i ? { name } : s)));
  }
  function moveStatus(i: number, dir: -1 | 1): void {
    const next = [...statuses];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setStatuses(next);
  }
</script>

<svelte:window onkeydown={$settingsOpen ? onWindowKeydown : undefined} />

<div class="modal" class:modal-open={$settingsOpen} role="dialog" aria-modal="true" aria-label="Settings">
  <div class="modal-box flex h-[80vh] max-w-3xl flex-col overflow-hidden p-0">
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
      <!-- Scope selector: Kanban, Extensions and Tools are per-scope and inherited,
           so they need to say which scope they are showing. The other sections are
           app-level and ignore it. -->
      {#if SCOPED_SECTIONS.includes(section) && scopes.length > 1}
        <div class="mb-4 flex items-center gap-1 border-b border-base-300 pb-3">
          <span class="mr-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">Scope</span>
          {#each scopes as s (s.id)}
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              class:btn-active={scope === s.id}
              aria-pressed={scope === s.id}
              onclick={() => editScope(s.id)}
            >{s.label}</button>
          {/each}
          <span class="ml-2 text-xs opacity-60">
            {inRoot ? "Shared with every workspace." : "This workspace only; adds to what it inherits from root."}
          </span>
        </div>
      {/if}

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
          bind:value={$settings.appearance.theme}
        >
          {#each THEMES as t (t)}
            <option value={t}>{t}</option>
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

      {/if}

      {#if section === "kanban"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Kanban</div>
      <div class="text-sm">Default statuses</div>
      <div class="mt-0.5 text-xs opacity-70">
        The columns a board in this scope starts with, in order. A scope's board is created
        the first time its Kanban module opens; after that, edit its columns on the board
        itself.
      </div>
      {#if statuses.length === 0}
        <div class="mt-3 rounded bg-base-200 px-3 py-2 text-xs opacity-70">
          {inRoot
            ? "Using the built-in defaults: Backlog, Todo, In Progress, Done."
            : "Inheriting root's statuses. Adding one here overrides them for this workspace."}
        </div>
      {/if}
      <ul class="mt-3 flex flex-col gap-2">
        {#each statuses as status, i (i)}
          <li class="flex items-center gap-2">
            <input
              class="input input-bordered input-sm flex-1"
              aria-label={`Status ${i + 1} name`}
              value={status.name}
              oninput={(e) => renameStatus(i, e.currentTarget.value)}
            />
            <button
              type="button"
              class="btn btn-square btn-ghost btn-sm"
              aria-label="Move up"
              disabled={i === 0}
              onclick={() => moveStatus(i, -1)}
            >↑</button>
            <button
              type="button"
              class="btn btn-square btn-ghost btn-sm"
              aria-label="Move down"
              disabled={i === statuses.length - 1}
              onclick={() => moveStatus(i, 1)}
            >↓</button>
            <button
              type="button"
              class="btn btn-square btn-ghost btn-sm"
              aria-label="Remove status"
              onclick={() => removeStatus(i)}
            >✕</button>
          </li>
        {/each}
      </ul>
      <button type="button" class="btn btn-sm mt-3" onclick={addStatus}>Add status</button>

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

      {#if section === "extensions"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Extensions</div>
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
      {/if}

      {#if section === "tools"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Tools</div>
      {#if !tools}
        <div class="text-xs opacity-70">Available in the desktop app only.</div>
      {:else}
        <div class="mt-0.5 text-xs opacity-70">
          Tools defined by you or by an agent. An agent-written tool cannot run until you
          review its code and approve it here, and then only in Chat modules opened
          afterwards.
        </div>

        <div class="mt-4 mb-2 text-xs opacity-70">Awaiting review:</div>
        {#if ownPending.length > 0}
          <ul class="divide-y divide-base-300 rounded border border-warning/50">
            {#each ownPending as t (toolKey(t))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-mono text-xs">{t.name}</span>
                  <div class="flex shrink-0 gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => review(t)}
                    >{reviewing === toolKey(t) ? "Hide" : "Review"}</button>
                    <button
                      type="button"
                      class="btn btn-warning btn-xs"
                      disabled={toolBusy || reviewing !== toolKey(t)}
                      title={reviewing === toolKey(t) ? "" : "Review the source first"}
                      onclick={() =>
                      toolAction(
                        () => tools.toolsApprove({ scope, name: t.name }),
                        `Approved ${t.name}. Open a new Chat module to load it.`,
                      )}
                    >Approve</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      disabled={toolBusy}
                      onclick={() =>
                      toolAction(
                        () => tools.toolsReject({ scope, name: t.name }),
                        `Rejected ${t.name}.`,
                      )}
                    >Reject</button>
                  </div>
                </div>
                {#if reviewing === toolKey(t)}
                  <div class="mt-2 text-xs opacity-80">
                    This code runs with full system access once approved. Read it before approving.
                    {#if inRoot}Approving here grants it to every workspace.{/if}
                  </div>
                  <pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
                    >{reviewSource}</code></pre>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-xs opacity-60">Nothing awaiting review.</div>
        {/if}

        <div class="mt-4 mb-2 text-xs opacity-70">Approved:</div>
        {#if ownApproved.length > 0}
          <ul class="max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
            {#each ownApproved as t (toolKey(t))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-mono text-xs">{t.name}</span>
                  <div class="flex shrink-0 gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => review(t)}
                    >{reviewing === toolKey(t) ? "Hide" : "View"}</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      disabled={toolBusy}
                      onclick={() =>
                      toolAction(
                        () => tools.toolsRevoke({ scope, name: t.name }),
                        `Revoked ${t.name}. Reopen Chat modules to apply.`,
                      )}
                    >Revoke</button>
                  </div>
                </div>
                {#if reviewing === toolKey(t)}
                  <pre class="mt-2 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
                    >{reviewSource}</code></pre>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-xs opacity-60">None approved.</div>
        {/if}

        <!-- Inherited from root: visible to this workspace's agents, but approved and
             revoked in root, so they are read-only here. -->
        {#if inheritedTools.length > 0}
          <div class="mt-4 mb-2 text-xs opacity-70">Inherited from Root:</div>
          <ul class="max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-base-300 border-dashed">
            {#each inheritedTools as t (toolKey(t))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-mono text-xs opacity-70">{t.name}</span>
                  <div class="flex shrink-0 items-center gap-2">
                    {#if t.state === "pending"}
                      <span class="text-[0.65rem] opacity-60">pending in Root</span>
                    {/if}
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => review(t)}
                    >{reviewing === toolKey(t) ? "Hide" : "View"}</button>
                  </div>
                </div>
                {#if reviewing === toolKey(t)}
                  <pre class="mt-2 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
                    >{reviewSource}</code></pre>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if toolNotice}<div class="mt-2 text-xs text-success">{toolNotice}</div>{/if}
        {#if toolError}<div class="mt-2 break-all text-xs text-error">{toolError}</div>{/if}
      {/if}
      {/if}
      </div>
    </div>
  </div>
  <button type="button" class="modal-backdrop" aria-label="Close settings" onclick={close}></button>
</div>
