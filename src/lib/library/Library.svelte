<script lang="ts">
  import { ROOT } from "../scope/paths.ts";
  import {
    extensionBindings,
    type ExtensionSource,
    type ExtSearchResult,
  } from "../extensions/bindings.ts";
  import { promptBindings } from "../prompts/bindings.ts";
  import { skillBindings } from "../skills/bindings.ts";
  import { extensionItems } from "../extensions/items.ts";
  import { type Draft, promptItems } from "../prompts/items.ts";
  import { skillItems } from "../skills/items.ts";
  import { groupItems, type LibraryItem, type LibraryKind } from "./items.ts";
  import { refreshChatCommands } from "../chat/store.ts";
  import ExtensionReview from "../extensions/ExtensionReview.svelte";
  import PromptDetail from "../prompts/PromptDetail.svelte";
  import PromptEditor from "../prompts/PromptEditor.svelte";
  import SkillDetail from "../skills/SkillDetail.svelte";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  // Which scope this module acts on: its own workspace's, or the shared root one it
  // inherits from. Root itself has nothing else to switch to, so the toggle is hidden
  // there — same shape as Kanban's board switcher.
  //
  // `workspaceId` is optional only because Column threads it through as optional; every
  // real workspace has an id, and root's IS `ROOT` (session.ts).
  const workspace = $derived(workspaceId ?? ROOT);
  const isRootWorkspace = $derived(workspace === ROOT);
  let showRoot = $state(false);
  const scope = $derived(showRoot ? ROOT : workspace);
  // NOT the same as isRootWorkspace: a workspace viewing root's list is editing root.
  // This is what decides whether enabling here reaches every workspace.
  const scopeIsRoot = $derived(scope === ROOT);

  // A module tab stays mounted when it is not active (Column.svelte hides it with a
  // class), so nothing re-lists on its own — bumping this counter is how the user asks.
  let refreshKey = $state(0);

  const ext = extensionBindings();
  const prompts = promptBindings();
  const skills = skillBindings();
  // All three factories read the same `globalThis.bindings`, so one check covers the
  // lot: in web mode there is no desktop backend at all.
  const desktop = ext !== null && prompts !== null && skills !== null;

  let items = $state<LibraryItem[]>([]);
  let loadErrors = $state<Array<{ name: string; error: string }>>([]);
  const groups = $derived(groupItems(items));

  let busy = $state(false);
  let notice = $state("");
  let error = $state("");

  // The expanded row, by LibraryItem.key, and the extension source read for it.
  let openKey = $state<string | null>(null);
  let reviewed = $state<ExtensionSource | null>(null);

  // Browse the pi catalog, and add a source by hand. Both land in the same confirm gate:
  // downloading an npm package runs its install scripts, which happens before any review
  // is possible (docs/extensions.md).
  let query = $state("");
  let results = $state<ExtSearchResult[]>([]);
  let searching = $state(false);
  let source = $state("");
  let sourceOpen = $state(false);
  let confirming = $state(false);

  let draft = $state<Draft | null>(null);

  const KIND_LABEL: Record<LibraryKind, string> = {
    extension: "ext",
    prompt: "prompt",
    skill: "skill",
  };

  // One read for the whole module. Every call is fired together and discarded together:
  // a scope switch that lands mid-flight must not paint one scope's extensions beside
  // another's templates.
  async function refresh(): Promise<void> {
    if (!ext || !prompts || !skills) return;
    const forScope = scope;
    // Captured, not re-read after the await: reading the prop again would mix one
    // scope's list with the other's answer to "does this scope inherit".
    const forIsRoot = scopeIsRoot;
    try {
      const [visibleExts, failures, ownPrompts, rootPrompts, visibleSkills] = await Promise
        .all([
          ext.extensionsVisible({ scope: forScope }),
          ext.extensionsLoadErrors({ scope: forScope }).catch(() => []),
          prompts.promptsList({ scope: forScope }),
          // Root inherits from nothing; passing its own list here would list every one
          // of its templates twice.
          forIsRoot ? Promise.resolve([]) : prompts.promptsList({ scope: ROOT }),
          skills.skillsVisible({ scope: forScope }),
        ]);
      if (forScope !== scope) return;
      items = [
        ...extensionItems(visibleExts, forScope),
        ...promptItems(ownPrompts, rootPrompts, forScope),
        ...skillItems(visibleSkills, forScope),
      ];
      loadErrors = failures;
    } catch (e) {
      if (forScope !== scope) return;
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Every mutation has the same shape: run, collapse the open row, re-list, report.
  // `touchesPrompts` adds one step — a template change alters what `/` offers, so live
  // conversations re-read their menus.
  async function act(
    run: () => Promise<unknown>,
    message: string,
    touchesPrompts = false,
  ): Promise<void> {
    const forScope = scope;
    busy = true;
    error = "";
    notice = "";
    try {
      await run();
      openKey = null;
      draft = null;
      await refresh();
      if (touchesPrompts) refreshChatCommands();
      // A scope switch during the mutation would otherwise report "Enabled X" over a
      // list that no longer contains X.
      if (forScope === scope) notice = message;
    } catch (e) {
      if (forScope === scope) error = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }

  async function toggle(item: LibraryItem): Promise<void> {
    if (openKey === item.key) {
      openKey = null;
      return;
    }
    error = "";
    if (item.kind === "extension") {
      if (!ext) return;
      try {
        // Read here rather than in ExtensionReview: the digest handed to
        // extensionsEnable must be the one THIS read produced, or the gate proves
        // nothing about the bytes that were on screen.
        reviewed = await ext.extensionsRead({
          scope: item.scope,
          id: item.ext.id,
          state: item.ext.state,
        });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        return;
      }
    }
    openKey = item.key;
  }

  // Each of these destructures its payload BEFORE building the closure. TypeScript
  // narrows a `const` inside a closure but not a parameter, so reaching for `item.ext`
  // from inside the callback would lose the narrowing that the `item.kind` check just
  // established.
  //
  // One verb over two backends: enabling an extension lets code run, approving a
  // template lets text be sent — the same act of letting something out of quarantine,
  // which is why the button says the same word and the badge carries the difference.
  function enable(item: LibraryItem): void {
    if (item.kind === "extension" && ext) {
      const { id, name } = item.ext;
      // What was actually read. The backend refuses the enable if the bytes changed
      // since, however long this tab has been open.
      const expectDigest = reviewed?.digest;
      act(
        () => ext.extensionsEnable({ scope, id, expectDigest }),
        `Enabled ${name}. Type /reload in a Chat module to load it there.`,
      );
    } else if (item.kind === "prompt" && prompts) {
      const { name } = item.prompt;
      act(
        () => prompts.promptsApprove({ scope, name }),
        `Enabled ${item.title}. Type ${item.title} in a chat to use it.`,
        true,
      );
    }
  }

  function revoke(item: LibraryItem): void {
    if (item.kind !== "extension" || !ext) return;
    const { id, name } = item.ext;
    act(
      () => ext.extensionsRevoke({ scope, id }),
      `Revoked ${name}. It is back in Awaiting review; /reload a Chat module to apply.`,
    );
  }

  function remove(item: LibraryItem): void {
    if (item.kind === "extension" && ext) {
      const { id, name, state } = item.ext;
      act(
        () => ext.extensionsRemove({ scope, id, state }),
        `Deleted ${name}.${item.state === "active" ? " /reload a Chat module to apply." : ""}`,
      );
    } else if (item.kind === "prompt" && prompts) {
      const { name } = item.prompt;
      const pending = item.state === "pending";
      // One label over two bindings: reject takes a pending template out of quarantine,
      // delete removes a live one. Both remove the file; only the directories differ.
      act(
        () =>
          pending
            ? prompts.promptsReject({ scope, name })
            : prompts.promptsDelete({ scope, name, state: "live" }),
        `Deleted ${item.title}.`,
        true,
      );
    }
  }

  function edit(item: LibraryItem): void {
    if (item.kind !== "prompt") return;
    draft = {
      name: item.prompt.name,
      description: item.prompt.description,
      argumentHint: item.prompt.argumentHint ?? "",
      body: item.prompt.body,
      creating: false,
    };
  }

  function newPrompt(): void {
    draft = { name: "", description: "", argumentHint: "", body: "", creating: true };
  }

  function saveDraft(): void {
    const d = draft;
    if (!prompts || !d) return;
    act(
      () =>
        prompts.promptsSave({
          scope,
          name: d.name.trim(),
          description: d.description.trim(),
          // Absent and empty mean the same thing for a hint, so "" is not written.
          argumentHint: d.argumentHint.trim() || undefined,
          body: d.body,
        }),
      `Saved /${d.name.trim()}. Type /${d.name.trim()} in a chat to use it.`,
      true,
    );
  }

  async function search(): Promise<void> {
    if (!ext) return;
    searching = true;
    error = "";
    try {
      results = await ext.extensionsSearch({ query: query.trim() });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    searching = false;
  }

  // Fetch the bytes into quarantine. This does NOT enable anything — it lands in
  // Awaiting review alongside agent-written modules, and you read its code first.
  async function confirmFetch(): Promise<void> {
    confirming = false;
    if (!ext) return;
    const wanted = source.trim();
    await act(
      () => ext.extensionsFetch({ scope, source: wanted }),
      "Downloaded. Review it under Awaiting review, then Enable it.",
    );
    if (!error) {
      source = "";
      sourceOpen = false;
    }
  }

  // Re-list when the scope changes or Refresh is pressed — both change what this shows.
  // Clears stale notices and collapses any open row.
  $effect(() => {
    void refreshKey;
    if (desktop && scope) {
      error = "";
      notice = "";
      confirming = false;
      openKey = null;
      refresh();
    }
  });

  // A draft belongs to the scope it was started in — saving it after a switch would
  // write it into the wrong one. Refresh must NOT discard it: that button sits directly
  // above the editor, and a draft is unsaved user input.
  $effect(() => {
    void scope;
    draft = null;
  });
</script>

<!-- One row for every kind. What differs between kinds is which buttons it carries and
     what expanding it shows; everything else — badge, title, subtitle — is common, which
     is the whole reason these three lists became one. -->
{#snippet row(item: LibraryItem)}
  <li class="px-3 py-2">
    <div class="flex items-center justify-between gap-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="badge badge-ghost badge-xs shrink-0">{KIND_LABEL[item.kind]}</span>
        {#if item.badge}
          <span class="badge badge-ghost badge-xs shrink-0 opacity-70">{item.badge}</span>
        {/if}
        <span
          class="truncate font-mono text-xs"
          class:opacity-70={item.state === "inherited"}
          title={item.subtitle ?? item.title}
        >{item.title}</span>
        {#if item.subtitle}
          <span class="truncate text-[0.65rem] opacity-60">{item.subtitle}</span>
        {/if}
      </span>
      <div class="flex shrink-0 gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => toggle(item)}
        >{openKey === item.key ? "Hide" : item.state === "pending" ? "Review" : "View"}</button>
        {#if item.state === "pending"}
          <!-- Disabled until the row is expanded. Approving without looking is the
               failure the whole gate exists to prevent, and that is as true of text
               that becomes your message as of code that executes. -->
          <button
            type="button"
            class="btn btn-warning btn-xs"
            disabled={busy || openKey !== item.key}
            title={openKey === item.key ? "" : "Read it first"}
            onclick={() => enable(item)}
          >Enable</button>
        {:else if item.state === "active" && item.kind === "extension"}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={busy}
            onclick={() => revoke(item)}
          >Revoke</button>
        {:else if item.state === "active" && item.kind === "prompt"}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={busy}
            onclick={() => edit(item)}
          >Edit</button>
        {/if}
        {#if item.state !== "inherited" && item.kind !== "skill"}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={busy}
            onclick={() => remove(item)}
          >Delete</button>
        {/if}
      </div>
    </div>

    {#if openKey === item.key}
      {#if item.state === "pending"}
        <div class="mt-2 text-xs opacity-80">
          {#if item.kind === "extension"}
            This code runs with full system access once enabled. Read it before enabling.
          {:else}
            This text is sent as your message when you invoke it.
          {/if}
          {#if scopeIsRoot}Enabling here reaches every workspace.{/if}
        </div>
      {/if}
      {#if item.kind === "extension"}
        {#if reviewed}<ExtensionReview source={reviewed} />{/if}
      {:else if item.kind === "prompt"}
        <PromptDetail prompt={item.prompt} />
      {:else}
        <SkillDetail skill={item.skill} />
      {/if}
    {/if}

    {#if item.problem}
      <div class="mt-1.5 break-all text-[0.65rem] text-error">{item.problem}</div>
    {/if}
    {#if item.note}
      <div class="mt-1 text-[0.65rem] opacity-50">{item.note}</div>
    {/if}
  </li>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-3 py-1.5">
    <span class="text-xs font-semibold">Library</span>

    {#if !isRootWorkspace}
      <div class="ml-3 flex items-center gap-1" role="group" aria-label="Scope">
        <span class="mr-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">Scope</span>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={!showRoot}
          aria-pressed={!showRoot}
          onclick={() => (showRoot = false)}
        >Workspace</button>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={showRoot}
          aria-pressed={showRoot}
          onclick={() => (showRoot = true)}
        >Root</button>
        <span class="ml-2 text-xs opacity-60">
          {showRoot
            ? "Shared with every workspace."
            : "This workspace only; adds to what it inherits from root."}
        </span>
      </div>
    {/if}

    <button
      class="btn btn-ghost btn-xs ml-auto"
      aria-label="Refresh"
      title="Re-read this scope's extensions, templates and skills"
      onclick={() => refreshKey++}
    >↻</button>
  </div>

  {#if !desktop}
    <div class="p-4 text-xs opacity-70">Available in the desktop app only.</div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <!-- The Add bar. The catalog searches pi PACKAGES, which is the install path for
           extensions, templates and skills alike — which is why it sits above the whole
           library rather than under one part of it. -->
      <div class="flex gap-2">
        <input
          class="input input-bordered input-sm flex-1"
          placeholder="Search the pi catalog…"
          aria-label="Search the pi catalog"
          bind:value={query}
          disabled={busy || searching}
          onkeydown={(e) => e.key === "Enter" && search()}
        />
        <button type="button" class="btn btn-sm" disabled={busy || searching} onclick={search}>
          {searching ? "Searching…" : "Search"}
        </button>
        <button type="button" class="btn btn-sm" disabled={busy} onclick={newPrompt}>
          New prompt
        </button>
        <button
          type="button"
          class="btn btn-sm"
          disabled={busy}
          onclick={() => (sourceOpen = !sourceOpen)}
        >Add source…</button>
      </div>

      {#if draft}
        <div class="mt-3">
          <PromptEditor
            bind:draft
            {busy}
            onsave={saveDraft}
            oncancel={() => (draft = null)}
          />
        </div>
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
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={() => (confirming = false)}
            >Cancel</button>
          </div>
        </div>
      {:else if sourceOpen}
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
                onclick={() => {
                  source = r.source;
                  confirming = true;
                }}
              >Add</button>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Enabled but unloadable. Kept out of the rows on purpose: a failure names a
           file inside an install tree, not the source string a row shows, so matching
           them up would silently miss. -->
      {#if loadErrors.length > 0}
        <div class="mt-4 rounded border border-error/50 p-2">
          <div class="text-xs text-error">
            Enabled, but {loadErrors.length === 1 ? "one extension" : "these extensions"}
            failed to load — the agent does not get {loadErrors.length === 1
            ? "its"
            : "their"} tools:
          </div>
          <ul class="mt-1 space-y-1">
            {#each loadErrors as f (f.name)}
              <li class="text-[0.65rem]">
                <span class="font-mono opacity-80">{f.name}</span>
                <span class="opacity-60"> — {f.error.split("\n")[0]}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="mt-4 mb-2 text-xs opacity-70">Awaiting review:</div>
      {#if groups.pending.length > 0}
        <ul class="divide-y divide-base-300 rounded border border-warning/50">
          {#each groups.pending as item (item.key)}{@render row(item)}{/each}
        </ul>
      {:else}
        <div class="text-xs opacity-60">Nothing awaiting review.</div>
      {/if}

      <div class="mt-4 mb-2 text-xs opacity-70">Active:</div>
      {#if groups.active.length > 0}
        <ul class="divide-y divide-base-300 rounded border border-base-300">
          {#each groups.active as item (item.key)}{@render row(item)}{/each}
        </ul>
      {:else}
        <div class="text-xs opacity-60">Nothing yet.</div>
      {/if}

      {#if groups.inherited.length > 0}
        <div class="mt-4 mb-2 text-xs opacity-70">
          Inherited from Root <span class="opacity-60">— managed there, not here</span>:
        </div>
        <ul class="divide-y divide-base-300 rounded border border-dashed border-base-300">
          {#each groups.inherited as item (item.key)}{@render row(item)}{/each}
        </ul>
      {/if}

      <div class="mt-4 text-[0.65rem] opacity-50">
        Extensions add tools to Chat and load into sessions started afterwards, or on
        <code>/reload</code>. A template is sent by typing <code>/name</code>. Skills are
        read-only here — add one by putting a <code>&lt;name&gt;/SKILL.md</code> directory
        or a <code>&lt;name&gt;.md</code> file in this scope's <code>agent/skills/</code>.
      </div>

      {#if notice}<div class="mt-2 text-xs text-success">{notice}</div>{/if}
      {#if error}<div class="mt-2 break-all text-xs text-error">{error}</div>{/if}
    </div>
  {/if}
</div>
