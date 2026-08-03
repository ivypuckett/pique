<script lang="ts">
  import { settings, settingsOpen, THEMES } from "./store.ts";
  import { providerBindings, type ProviderInfo } from "../chat/bindings.ts";
  import {
    type Extension,
    extensionBindings,
    type ExtensionSource,
    type ExtSearchResult,
  } from "../extensions/bindings.ts";
  import { profileBindings, type ProfileInfo } from "../profiles/bindings.ts";
  import { editing, editScope, updateScopeConfig } from "../scope/store.ts";
  import { ROOT } from "../scope/paths.ts";
  import { activeWorkspace } from "../store.ts";

  // Which scope the scoped sections (Kanban, Extensions, Profiles) act on. Root is the
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

  // Extensions — ONE list covering both origins: loose `.ts` modules written by the
  // user or by an agent (define_extension), and installed pi packages. An extension
  // runs iff it is in pi's own loading set; it awaits review iff there is a file for it
  // in the scope's pending dir. Null in web-dev (no bindings) → desktop-only note.
  const ext = extensionBindings();
  let visible = $state<Extension[]>([]);
  let source = $state("");
  let busy = $state(false);
  let extError = $state("");
  let extNotice = $state("");
  // Guards the FETCH, not the enable: downloading an npm package runs its install
  // scripts, which happens before any review is possible (see docs/extensions.md).
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

  // Browse: query pi packages via npm (see packages.ts). A result's Add routes
  // through the same `confirming` gate as the manual source input.
  let query = $state("");
  let results = $state<ExtSearchResult[]>([]);
  let searching = $state(false);

  // The extension whose code is expanded, and what was read back. Reviewing before
  // Enable is deliberately required for BOTH origins: the code is the artifact, and
  // for a package that means the entry files pi resolved, not the source string.
  let reviewing = $state<string | null>(null);
  let reviewed = $state<ExtensionSource | null>(null);

  // `visible` is everything reachable from the selected scope. Only the scope's OWN
  // extensions can be acted on here; inherited ones are managed where they live.
  const ownPending = $derived(visible.filter((e) => e.state === "pending" && e.scope === scope));
  const ownEnabled = $derived(visible.filter((e) => e.state === "enabled" && e.scope === scope));
  const inherited = $derived(visible.filter((e) => e.scope !== scope));

  async function search(): Promise<void> {
    if (!ext) return;
    searching = true;
    extError = "";
    try {
      results = await ext.extensionsSearch({ query: query.trim() });
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
    searching = false;
  }

  function addResult(r: ExtSearchResult): void {
    source = r.source;
    confirming = true;
  }

  async function refreshExts(): Promise<void> {
    if (!ext) return;
    try {
      visible = await ext.extensionsVisible({ scope });
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

  // Re-list whenever the modal opens OR the scope changes — both change what this
  // list should show. Clears stale notices and collapses any open review.
  $effect(() => {
    if ($settingsOpen && ext && scope) {
      extError = "";
      extNotice = "";
      confirming = false;
      reviewing = null;
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

  // Fetch the bytes into quarantine. This does NOT enable the package — it lands in
  // Awaiting review alongside agent-written modules, and the user reads its code first.
  async function confirmFetch(): Promise<void> {
    confirming = false;
    if (!ext) return;
    busy = true;
    extError = "";
    extNotice = "";
    try {
      await ext.extensionsFetch({ scope, source: source.trim() });
      source = "";
      await refreshExts();
      extNotice = "Downloaded. Review its code below, then Enable it.";
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }

  // Keyed by scope AND id: the same name can exist in root and in a workspace, and
  // expanding one must not expand the other.
  function extKey(e: Extension): string {
    return `${e.scope}/${e.id}`;
  }

  async function toggleReview(e: Extension): Promise<void> {
    if (!ext) return;
    if (reviewing === extKey(e)) {
      reviewing = null;
      return;
    }
    extError = "";
    try {
      reviewed = await ext.extensionsRead({ scope: e.scope, id: e.id, state: e.state });
      reviewing = extKey(e);
    } catch (err) {
      extError = err instanceof Error ? err.message : String(err);
    }
  }

  // The mutations share a shape: run, re-list, report. `notice` is what the user sees
  // on success — each spells out when the change actually takes effect.
  async function extAction(run: () => Promise<unknown>, notice: string): Promise<void> {
    busy = true;
    extError = "";
    extNotice = "";
    try {
      await run();
      reviewing = null;
      await refreshExts();
      extNotice = notice;
    } catch (e) {
      extError = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }

  // Profiles — a base prompt plus a tool allowlist, per scope (profiles/service.ts).
  // Unlike tools, a profile is inert data: the review is of prompt TEXT, which is why
  // the whole file is shown rather than only being offered on request.
  const profiles = profileBindings();
  let ownProfiles = $state<ProfileInfo[]>([]);
  let rootProfiles = $state<ProfileInfo[]>([]);
  let profileError = $state("");
  let profileNotice = $state("");
  let profileBusy = $state(false);
  let openProfile = $state<string | null>(null);

  const pendingProfiles = $derived(ownProfiles.filter((p) => p.state === "pending"));
  const liveProfiles = $derived(ownProfiles.filter((p) => p.state === "live"));
  // Root's live profiles are selectable in a workspace, but approved and revoked in
  // root — so they are listed here read-only. A local profile of the same name shadows
  // one of root's (profiles/service.ts), which the label has to say.
  const inheritedProfiles = $derived(
    inRoot ? [] : rootProfiles.filter((p) => p.state === "live"),
  );

  async function refreshProfiles(): Promise<void> {
    if (!profiles) return;
    try {
      ownProfiles = await profiles.profilesList({ scope });
      rootProfiles = inRoot ? [] : await profiles.profilesList({ scope: ROOT });
    } catch (e) {
      profileError = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    if ($settingsOpen && profiles && scope) {
      profileError = "";
      profileNotice = "";
      openProfile = null;
      refreshProfiles();
    }
  });

  function profileKey(p: ProfileInfo): string {
    return `${p.scope}/${p.name}`;
  }

  // Same shape as toolAction: run, re-list, report — with a notice that says when the
  // change takes effect.
  async function profileAction(run: () => Promise<unknown>, notice: string): Promise<void> {
    profileBusy = true;
    profileError = "";
    profileNotice = "";
    try {
      await run();
      openProfile = null;
      await refreshProfiles();
      profileNotice = notice;
    } catch (e) {
      profileError = e instanceof Error ? e.message : String(e);
    }
    profileBusy = false;
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
    { id: "profiles", label: "Profiles" },
  ] as const;
  let section = $state<(typeof SECTIONS)[number]["id"]>("appearance");

  // Sections whose content belongs to a scope rather than the app. Appearance and
  // Workspace are app-wide; Providers are shared with the `pi` CLI machine-wide.
  const SCOPED_SECTIONS: readonly string[] = ["kanban", "extensions", "profiles"];

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

      <!-- One review pane for both origins. A local module is always a single file; a
           package is however many entry files pi resolved for it, which is what makes
           this the same gate rather than a source string for one origin and code for
           the other. -->
      {#snippet reviewPane()}
        {#if reviewed}
          {#each reviewed.files as f (f.path)}
            <div class="mt-2 truncate font-mono text-[0.65rem] opacity-60" title={f.path}>{f.path}</div>
            <pre class="mt-1 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
              >{f.text}</code></pre>
          {/each}
          {#if reviewed.files.length === 0}
            <div class="mt-2 text-xs opacity-60">
              No extension entry files — this package ships skills or prompts only.
            </div>
          {/if}
          {#if reviewed.skills.length > 0}
            <div class="mt-2 text-xs opacity-70">
              Also ships {reviewed.skills.length}
              skill{reviewed.skills.length === 1 ? "" : "s"} — not code, but their text reaches
              the agent:
            </div>
            <ul class="mt-1 max-h-24 overflow-y-auto text-[0.65rem] opacity-60">
              {#each reviewed.skills as sk (sk)}
                <li class="truncate font-mono" title={sk}>{sk}</li>
              {/each}
            </ul>
          {/if}
          {#if reviewed.truncated}
            <div class="mt-1 text-[0.65rem] text-warning">
              Long file truncated for display — read it on disk before enabling.
            </div>
          {/if}
        {/if}
      {/snippet}

      {#if section === "extensions"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Extensions</div>
      {#if !ext}
        <div class="text-xs opacity-70">Available in the desktop app only.</div>
      {:else}
        <div class="mt-0.5 text-xs opacity-70">
          Extensions add tools and commands to Chat — either a pi package or a module
          written by you or by an agent. Nothing runs until you read its code and enable
          it here, and then only in Chat modules opened afterwards.
        </div>

        <!-- Awaiting review: both origins, together. Enable stays disabled until the
             code is expanded — approving without looking is the failure mode the whole
             gate exists to prevent. -->
        <div class="mt-4 mb-2 text-xs opacity-70">Awaiting review:</div>
        {#if ownPending.length > 0}
          <ul class="divide-y divide-base-300 rounded border border-warning/50">
            {#each ownPending as e (extKey(e))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="badge badge-ghost badge-xs shrink-0">{e.origin}</span>
                    <span class="truncate font-mono text-xs" title={e.path ?? e.name}>{e.name}</span>
                  </span>
                  <div class="flex shrink-0 gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => toggleReview(e)}
                    >{reviewing === extKey(e) ? "Hide" : "Review"}</button>
                    <button
                      type="button"
                      class="btn btn-warning btn-xs"
                      disabled={busy || reviewing !== extKey(e)}
                      title={reviewing === extKey(e) ? "" : "Review the code first"}
                      onclick={() =>
                      extAction(
                        () => ext.extensionsEnable({ scope, id: e.id }),
                        `Enabled ${e.name}. Open a new Chat module to load it.`,
                      )}
                    >Enable</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      disabled={busy}
                      onclick={() =>
                      extAction(
                        () => ext.extensionsRemove({ scope, id: e.id, state: "pending" }),
                        `Deleted ${e.name}.`,
                      )}
                    >Delete</button>
                  </div>
                </div>
                {#if reviewing === extKey(e)}
                  <div class="mt-2 text-xs opacity-80">
                    This code runs with full system access once enabled. Read it before enabling.
                    {#if inRoot && e.origin === "local"}Enabling here grants it to every workspace.{/if}
                  </div>
                  {@render reviewPane()}
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-xs opacity-60">Nothing awaiting review.</div>
        {/if}

        <!-- Enabled: both origins mixed, distinguished by the badge rather than by
             living in a separate section. Revoke returns to review; Delete removes. -->
        <div class="mt-4 mb-2 text-xs opacity-70">Enabled:</div>
        {#if ownEnabled.length > 0}
          <ul class="max-h-48 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
            {#each ownEnabled as e (extKey(e))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="badge badge-ghost badge-xs shrink-0">{e.origin}</span>
                    <span class="truncate font-mono text-xs" title={e.path ?? e.name}>{e.name}</span>
                  </span>
                  <div class="flex shrink-0 gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => toggleReview(e)}
                    >{reviewing === extKey(e) ? "Hide" : "View"}</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      disabled={busy}
                      onclick={() =>
                      extAction(
                        () => ext.extensionsRevoke({ scope, id: e.id }),
                        `Revoked ${e.name}. It is back in Awaiting review; reopen Chat modules to apply.`,
                      )}
                    >Revoke</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      disabled={busy}
                      onclick={() =>
                      extAction(
                        () => ext.extensionsRemove({ scope, id: e.id, state: "enabled" }),
                        `Deleted ${e.name}. Reopen Chat modules to apply.`,
                      )}
                    >Delete</button>
                  </div>
                </div>
                {#if reviewing === extKey(e)}
                  {@render reviewPane()}
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-xs opacity-60">None enabled.</div>
        {/if}

        <!-- Inherited from root: visible to this workspace's agents, but enabled and
             revoked in root, so they are read-only here. Packages are deliberately NOT
             inherited, which is why this group says "modules" — see docs/extensions.md. -->
        {#if inherited.length > 0}
          <div class="mt-4 mb-2 text-xs opacity-70">
            Inherited from Root <span class="opacity-60">— modules only; packages are per-scope</span>:
          </div>
          <ul class="max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-dashed border-base-300">
            {#each inherited as e (extKey(e))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate font-mono text-xs opacity-70">{e.name}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs shrink-0"
                    onclick={() => toggleReview(e)}
                  >{reviewing === extKey(e) ? "Hide" : "View"}</button>
                </div>
                {#if reviewing === extKey(e)}
                  {@render reviewPane()}
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        <div class="mt-5 mb-2 text-xs opacity-70">Browse the pi package catalog (via npm):</div>
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
                  onclick={() => addResult(r)}
                >Add</button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if confirming}
          <div class="mt-3 rounded border border-warning/50 bg-warning/10 p-3">
            <div class="text-sm font-medium text-warning">Download this package?</div>
            <div class="mt-1 break-all font-mono text-xs">{source.trim()}</div>
            <div class="mt-1.5 text-xs opacity-80">
              It will be fetched into quarantine for review, not enabled. Downloading an
              npm package runs its install scripts, so only fetch sources you trust.
            </div>
            <div class="mt-2 flex gap-2">
              <button type="button" class="btn btn-warning btn-sm" onclick={confirmFetch}>Download</button>
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
            >Add</button>
          </div>
        {/if}

        {#if extNotice}<div class="mt-2 text-xs text-success">{extNotice}</div>{/if}
        {#if extError}<div class="mt-2 break-all text-xs text-error">{extError}</div>{/if}
      {/if}
      {/if}

      {#if section === "profiles"}
      <div class="mb-3 text-xs uppercase tracking-wide text-primary">Profiles</div>
      {#if !profiles}
        <div class="text-xs opacity-70">Available in the desktop app only.</div>
      {:else}
        <div class="mt-0.5 text-xs opacity-70">
          A profile is a prompt plus an allowlist of tools, picked in a Chat module. Its
          tool list can only narrow what a session already has, never grant anything new.
          An agent-written profile cannot be selected until you read it and approve it here.
        </div>

        <div class="mt-4 mb-2 text-xs opacity-70">Awaiting review:</div>
        {#if pendingProfiles.length > 0}
          <ul class="divide-y divide-base-300 rounded border border-warning/50">
            {#each pendingProfiles as p (profileKey(p))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="truncate font-mono text-xs">{p.name}</div>
                    {#if p.description}<div class="truncate text-[0.65rem] opacity-60">{p.description}</div>{/if}
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => (openProfile = openProfile === profileKey(p) ? null : profileKey(p))}
                    >{openProfile === profileKey(p) ? "Hide" : "Review"}</button>
                    <button
                      type="button"
                      class="btn btn-warning btn-xs"
                      disabled={profileBusy || openProfile !== profileKey(p)}
                      title={openProfile === profileKey(p) ? "" : "Read the prompt first"}
                      onclick={() =>
                      profileAction(
                        () => profiles.profilesApprove({ scope, name: p.name }),
                        `Approved ${p.name}. Pick it in a Chat module to use it.`,
                      )}
                    >Approve</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      disabled={profileBusy}
                      onclick={() =>
                      profileAction(
                        () => profiles.profilesReject({ scope, name: p.name }),
                        `Rejected ${p.name}.`,
                      )}
                    >Reject</button>
                  </div>
                </div>
                {#if openProfile === profileKey(p)}
                  <div class="mt-2 text-xs opacity-80">
                    This text becomes part of the system prompt of any chat that runs under it.
                    {#if inRoot}Approving here makes it available in every workspace.{/if}
                  </div>
                  {#if p.rationale}
                    <div class="mt-1.5 text-[0.65rem] opacity-70">Agent's rationale: {p.rationale}</div>
                  {/if}
                  <div class="mt-1.5 text-[0.65rem] opacity-70">
                    Tools: {p.tools ? (p.tools.length ? p.tools.join(", ") : "none at all") : "unrestricted"}
                  </div>
                  <pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
                    >{p.body}</code></pre>
                {/if}
                {#if p.error}<div class="mt-1.5 break-all text-[0.65rem] text-error">{p.error}</div>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-xs opacity-60">Nothing awaiting review.</div>
        {/if}

        <div class="mt-4 mb-2 text-xs opacity-70">Available:</div>
        {#if liveProfiles.length > 0}
          <ul class="max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
            {#each liveProfiles as p (profileKey(p))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="truncate font-mono text-xs">{p.name}</div>
                    {#if p.description}<div class="truncate text-[0.65rem] opacity-60">{p.description}</div>{/if}
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => (openProfile = openProfile === profileKey(p) ? null : profileKey(p))}
                    >{openProfile === profileKey(p) ? "Hide" : "View"}</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      disabled={profileBusy}
                      onclick={() =>
                      profileAction(
                        () => profiles.profilesRevoke({ scope, name: p.name }),
                        `Deleted ${p.name}. Chats already running under it keep it until they restart.`,
                      )}
                    >Delete</button>
                  </div>
                </div>
                {#if openProfile === profileKey(p)}
                  <div class="mt-2 text-[0.65rem] opacity-70">
                    Tools: {p.tools ? (p.tools.length ? p.tools.join(", ") : "none at all") : "unrestricted"}
                  </div>
                  <pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
                    >{p.body}</code></pre>
                {/if}
                {#if p.error}<div class="mt-1.5 break-all text-[0.65rem] text-error">{p.error}</div>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="text-xs opacity-60">
            None yet. Add one as a markdown file in this scope's <code>profiles/</code> dir.
          </div>
        {/if}

        <!-- Root's profiles are selectable here but managed in root, so they are
             read-only. A local profile of the same name shadows one of these. -->
        {#if inheritedProfiles.length > 0}
          <div class="mt-4 mb-2 text-xs opacity-70">Inherited from Root:</div>
          <ul class="max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-dashed border-base-300">
            {#each inheritedProfiles as p (profileKey(p))}
              <li class="px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="truncate font-mono text-xs opacity-70">{p.name}</div>
                    {#if p.description}<div class="truncate text-[0.65rem] opacity-60">{p.description}</div>{/if}
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    {#if liveProfiles.some((own) => own.name === p.name)}
                      <span class="text-[0.65rem] opacity-60">shadowed</span>
                    {/if}
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => (openProfile = openProfile === profileKey(p) ? null : profileKey(p))}
                    >{openProfile === profileKey(p) ? "Hide" : "View"}</button>
                  </div>
                </div>
                {#if openProfile === profileKey(p)}
                  <div class="mt-2 text-[0.65rem] opacity-70">
                    Tools: {p.tools ? (p.tools.length ? p.tools.join(", ") : "none at all") : "unrestricted"}
                  </div>
                  <pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
                    >{p.body}</code></pre>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if profileNotice}<div class="mt-2 text-xs text-success">{profileNotice}</div>{/if}
        {#if profileError}<div class="mt-2 break-all text-xs text-error">{profileError}</div>{/if}
      {/if}
      {/if}
      </div>
    </div>
  </div>
  <button type="button" class="modal-backdrop" aria-label="Close settings" onclick={close}></button>
</div>
