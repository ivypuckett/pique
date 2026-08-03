<script lang="ts">
  import {
    type Extension,
    extensionBindings,
    type ExtensionSource,
    type ExtSearchResult,
  } from "./bindings.ts";

  // `scope` is the scope the Library module is pointed at; `inRoot` says whether that
  // scope is root, which changes what enabling here reaches. `refreshKey` is bumped by
  // the shell's Refresh button — re-read on any of them changing.
  let { scope, inRoot, refreshKey }: { scope: string; inRoot: boolean; refreshKey: number } =
    $props();

  const ext = extensionBindings();
  let visible = $state<Extension[]>([]);
  let source = $state("");
  let busy = $state(false);
  let extError = $state("");
  let extNotice = $state("");
  // Guards the FETCH, not the enable: downloading an npm package runs its install
  // scripts, which happens before any review is possible (see docs/extensions.md).
  let confirming = $state(false);

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

  // Re-list when the scope changes or the shell asks for a refresh — both change what
  // this list should show. Clears stale notices and collapses any open review.
  $effect(() => {
    void refreshKey;
    if (ext && scope) {
      extError = "";
      extNotice = "";
      confirming = false;
      reviewing = null;
      refreshExts();
    }
  });
</script>

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
