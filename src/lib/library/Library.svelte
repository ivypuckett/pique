<script lang="ts">
  import {
    extensionBindings,
    type ExtensionSource,
    type ExtSearchResult,
    PACKAGE_TYPES,
    type PackageType,
  } from "../extensions/bindings.ts";
  import { promptBindings } from "../prompts/bindings.ts";
  import { skillBindings } from "../skills/bindings.ts";
  import { systemPromptBindings } from "../prompts/system-bindings.ts";
  import { extensionItems } from "../extensions/items.ts";
  import { moduleItems } from "../modules/items.ts";
  import { hydrateModules, moduleBindings } from "../modules/bindings.ts";
  import { type Draft, promptItems } from "../prompts/items.ts";
  import { skillItems } from "../skills/items.ts";
  import {
    PROMPT_FILE_NAMES,
    promptFileItems,
    type PromptFileDraft,
  } from "../prompts/system-items.ts";
  import { type LibraryItem, type LibraryKind, sortItems } from "./items.ts";
  import { refreshChatCommands } from "../chat/store.ts";
  import ExtensionReview from "../extensions/ExtensionReview.svelte";
  import PromptDetail from "../prompts/PromptDetail.svelte";
  import PromptEditor from "../prompts/PromptEditor.svelte";
  import SkillDetail from "../skills/SkillDetail.svelte";
  import SystemPromptDetail from "../prompts/SystemPromptDetail.svelte";
  import SystemPromptEditor from "../prompts/SystemPromptEditor.svelte";

  // Settings → Library. Everything in pi's agent dir (~/.pi/agent), which pique shares
  // with the `pi` CLI: the two prompt files, extensions and the modules beside them,
  // prompt templates and skills. One list, because pi loads all of it the same way — by
  // finding it there.
  //
  // Mounted when the section is opened, so it lists afresh each time; bumping this
  // counter is how the user asks for a re-read without leaving it.
  let refreshKey = $state(0);

  const ext = extensionBindings();
  const mods = moduleBindings();
  const prompts = promptBindings();
  const skills = skillBindings();
  const sysPrompts = systemPromptBindings();
  // All the factories read the same `globalThis.bindings`, so one check covers the lot:
  // in web mode there is no desktop backend at all.
  const desktop = ext !== null && prompts !== null && skills !== null &&
    sysPrompts !== null;

  let items = $state<LibraryItem[]>([]);
  let loadErrors = $state<Array<{ name: string; error: string }>>([]);
  const sorted = $derived(sortItems(items));

  let busy = $state(false);
  let notice = $state("");
  let error = $state("");

  // The expanded row, by LibraryItem.key, and the extension source read for it.
  let openKey = $state<string | null>(null);
  let source = $state<ExtensionSource | null>(null);

  // Browse the pi catalog, and add a source by hand. Both land in the same confirm:
  // downloading an npm package runs its install scripts (docs/extensions.md).
  let query = $state("");
  // Which kind of package to browse for, or null for all — the catalog's own facet
  // (pi.dev/packages?type=skill), not a filter over what is already installed.
  let type = $state<PackageType | null>(null);
  let results = $state<ExtSearchResult[]>([]);
  let searched = $state(false);
  let searching = $state(false);
  let installSource = $state("");
  let sourceOpen = $state(false);
  let confirming = $state(false);

  // Independent drafts rather than one union: the forms share no field, and opening
  // either closes the other, so the shell never has to ask which one is showing.
  let draft = $state<Draft | null>(null);
  let fileDraft = $state<PromptFileDraft | null>(null);

  const KIND_LABEL: Record<LibraryKind, string> = {
    extension: "ext",
    module: "module",
    prompt: "prompt",
    skill: "skill",
    system: "system",
    appendix: "appendix",
  };

  async function refresh(): Promise<void> {
    if (!ext || !prompts || !skills || !sysPrompts) return;
    try {
      const [exts, failures, promptList, skillList, files, moduleList] =
        await Promise.all([
          ext.extensionsList(),
          ext.extensionsLoadErrors().catch(() => []),
          prompts.promptsList(),
          skills.skillsList(),
          sysPrompts.systemPromptsList(),
          mods ? mods.moduleList() : Promise.resolve([]),
        ]);
      items = [
        ...promptFileItems(files),
        ...extensionItems(exts),
        ...moduleItems(moduleList),
        ...promptItems(promptList),
        ...skillItems(skillList),
      ];
      loadErrors = failures;
    } catch (e) {
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
    busy = true;
    error = "";
    notice = "";
    try {
      await run();
      openKey = null;
      draft = null;
      fileDraft = null;
      await refresh();
      if (touchesPrompts) refreshChatCommands();
      notice = message;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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
        source = await ext.extensionsRead({ id: item.ext.id });
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
  function remove(item: LibraryItem): void {
    if ((item.kind === "system" || item.kind === "appendix") && sysPrompts) {
      const { kind } = item;
      act(
        () => sysPrompts.systemPromptsDelete({ kind }),
        `Deleted ${item.title}. Type /reload in a Chat module to apply.`,
      );
    } else if (item.kind === "module" && mods) {
      const { kind } = item.module;
      act(
        () => mods.moduleRemove({ name: kind }).then(hydrateModules),
        `Deleted ${item.title}. An open tab of it now reads "Unknown module".`,
      );
    } else if (item.kind === "extension" && ext) {
      const { id, name } = item.ext;
      act(
        () => ext.extensionsRemove({ id }),
        `Deleted ${name}. /reload a Chat module to apply.`,
      );
    } else if (item.kind === "prompt" && prompts) {
      const { name } = item.prompt;
      act(
        () => prompts.promptsDelete({ name }),
        `Deleted ${item.title}.`,
        true,
      );
    }
  }

  function edit(item: LibraryItem): void {
    if (item.kind === "system" || item.kind === "appendix") {
      // An absent file opens the same empty form a present one opens after clearing it,
      // which is what makes "create" and "edit" one button here.
      fileDraft = { kind: item.kind, body: item.file.body ?? "" };
      draft = null;
      return;
    }
    if (item.kind !== "prompt") return;
    draft = {
      name: item.prompt.name,
      description: item.prompt.description,
      argumentHint: item.prompt.argumentHint ?? "",
      body: item.prompt.body,
      creating: false,
    };
    fileDraft = null;
  }

  function newPrompt(): void {
    draft = { name: "", description: "", argumentHint: "", body: "", creating: true };
    fileDraft = null;
  }

  function saveFileDraft(): void {
    const d = fileDraft;
    if (!sysPrompts || !d) return;
    const name = PROMPT_FILE_NAMES[d.kind];
    // An empty body deletes the file rather than writing one (prompts/system.ts), so
    // the notice has to say which of the two just happened.
    act(
      () => sysPrompts.systemPromptsSave({ kind: d.kind, body: d.body }),
      d.body.trim() === ""
        ? `Deleted ${name}. Type /reload in a Chat module to apply.`
        : `Saved ${name}. Type /reload in a Chat module to apply it to a running chat.`,
    );
  }

  function saveDraft(): void {
    const d = draft;
    if (!prompts || !d) return;
    act(
      () =>
        prompts.promptsSave({
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
      results = await ext.extensionsSearch({
        query: query.trim(),
        type: type ?? undefined,
      });
      searched = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    searching = false;
  }

  // Picking a facet re-runs the search rather than filtering what is on screen: a type
  // is part of the query the registry answers, and only ~2% of pi packages are themes,
  // so narrowing 25 fetched hits would usually leave none.
  function pickType(t: PackageType | null): void {
    type = t;
    if (searched || query.trim() !== "") search();
  }

  async function confirmInstall(): Promise<void> {
    confirming = false;
    if (!ext) return;
    const wanted = installSource.trim();
    await act(
      () => ext.extensionsInstall({ source: wanted }),
      `Installed ${wanted}. Type /reload in a Chat module to load it there.`,
    );
    if (!error) {
      installSource = "";
      sourceOpen = false;
    }
  }

  // Re-list when Refresh is pressed. Clears stale notices and collapses any open row,
  // but never discards a draft: that button sits directly above the editor, and a draft
  // is unsaved user input.
  $effect(() => {
    void refreshKey;
    if (desktop) {
      error = "";
      notice = "";
      confirming = false;
      openKey = null;
      refresh();
    }
  });
</script>

<!-- One row for every kind. What differs between kinds is which buttons it carries and
     what expanding it shows; everything else — badge, title, subtitle — is common. -->
{#snippet row(item: LibraryItem)}
  <li class="px-3 py-2">
    <div class="flex items-center justify-between gap-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="badge badge-ghost badge-xs shrink-0">{KIND_LABEL[item.kind]}</span>
        {#if item.badge && item.badge !== KIND_LABEL[item.kind]}
          <span class="badge badge-ghost badge-xs shrink-0 opacity-70">{item.badge}</span>
        {/if}
        <span class="truncate font-mono text-xs" title={item.subtitle ?? item.title}
        >{item.title}</span>
        {#if item.subtitle}
          <span class="truncate text-[0.65rem] opacity-60">{item.subtitle}</span>
        {/if}
      </span>
      <div class="flex shrink-0 gap-1">
        <button type="button" class="btn btn-ghost btn-xs" onclick={() => toggle(item)}
        >{openKey === item.key ? "Hide" : "View"}</button>
        {#if item.kind === "prompt" || item.kind === "system" || item.kind === "appendix"}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={busy}
            onclick={() => edit(item)}
          >Edit</button>
        {/if}
        <!-- A prompt-file row exists whether or not the file does, so Delete has to
             check the payload rather than the row: there is nothing to delete when it
             says "not set". -->
        {#if item.kind !== "skill" && !((item.kind === "system" || item.kind === "appendix") && item.file.body === undefined)}
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
      {#if item.kind === "extension"}
        {#if source}<ExtensionReview {source} />{/if}
      {:else if item.kind === "module"}
        <div class="mt-2 break-all font-mono text-[0.65rem] opacity-60">
          {item.module.kind}.module.json · {item.module.kind}.ui.html
        </div>
      {:else if item.kind === "prompt"}
        <PromptDetail prompt={item.prompt} />
      {:else if item.kind === "system" || item.kind === "appendix"}
        <SystemPromptDetail file={item.file} />
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

<div>
  <div class="mb-3 flex items-center gap-1">
    <span class="text-xs uppercase tracking-wide text-primary">Library</span>
    {#if desktop}
      <button
        class="btn btn-ghost btn-xs ml-auto"
        aria-label="Refresh"
        title="Re-read the prompt files, extensions, modules, templates and skills"
        onclick={() => refreshKey++}
      >↻</button>
    {/if}
  </div>

  {#if !desktop}
    <div class="text-xs opacity-70">Available in the desktop app only.</div>
  {:else}
    <div class="mb-3 text-xs opacity-70">
      pi's agent dir, <code>~/.pi/agent</code> — shared with the <code>pi</code> CLI.
    </div>
    <div>
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

      <!-- The catalog's kinds, not this list's. A pi package can carry extensions,
           skills, templates or a theme — searching without a facet returns all of them,
           which is what the unfiltered chip means. -->
      <div class="mt-2 flex items-center gap-1" role="group" aria-label="Package type">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          class:btn-active={type === null}
          aria-pressed={type === null}
          disabled={busy || searching}
          onclick={() => pickType(null)}
        >All</button>
        {#each PACKAGE_TYPES as t (t)}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            class:btn-active={type === t}
            aria-pressed={type === t}
            disabled={busy || searching}
            onclick={() => pickType(t)}
          >{t}s</button>
        {/each}
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

      {#if fileDraft}
        <div class="mt-3">
          <SystemPromptEditor
            bind:draft={fileDraft}
            {busy}
            onsave={saveFileDraft}
            oncancel={() => (fileDraft = null)}
          />
        </div>
      {/if}

      {#if confirming}
        <div class="mt-3 rounded border border-warning/50 bg-warning/10 p-3">
          <div class="text-sm font-medium text-warning">Install this package?</div>
          <div class="mt-1 break-all font-mono text-xs">{installSource.trim()}</div>
          <div class="mt-1.5 text-xs opacity-80">
            Its code runs with full system access in every chat, and downloading an npm
            package runs its install scripts. Only install sources you trust.
          </div>
          <div class="mt-2 flex gap-2">
            <button type="button" class="btn btn-warning btn-sm" onclick={confirmInstall}
            >Install</button>
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
            bind:value={installSource}
            disabled={busy}
          />
          <button
            type="button"
            class="btn btn-sm"
            disabled={busy || installSource.trim() === ""}
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
                <!-- What the package declares it carries, read from its npm keywords.
                     A package declaring nothing still installs, so it gets a generic
                     badge rather than none — an unbadged row would read as a bug. -->
                <div class="mt-1 flex flex-wrap gap-1">
                  {#each r.types.length > 0 ? r.types : ["package"] as t (t)}
                    <span class="badge badge-ghost badge-xs">{t}</span>
                  {/each}
                </div>
                <div class="mt-0.5 text-[0.65rem] opacity-50">
                  {#if r.author}{r.author} · {/if}{r.downloads.toLocaleString()}/mo
                </div>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs shrink-0"
                disabled={busy}
                onclick={() => {
                  installSource = r.source;
                  confirming = true;
                }}
              >Add</button>
            </li>
          {/each}
        </ul>
      {:else if searched && !searching}
        <div class="mt-3 text-xs opacity-60">
          No {type ? `${type} packages` : "packages"} match that search.
        </div>
      {/if}

      <!-- Installed but unloadable. Kept out of the rows on purpose: a failure names a
           file inside an install tree, not the source string a row shows, so matching
           them up would silently miss. -->
      {#if loadErrors.length > 0}
        <div class="mt-4 rounded border border-error/50 p-2">
          <div class="text-xs text-error">
            {loadErrors.length === 1 ? "One extension" : "These extensions"}
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

      <ul class="mt-4 divide-y divide-base-300 rounded border border-base-300">
        {#each sorted as item (item.key)}{@render row(item)}{/each}
      </ul>

      <div class="mt-4 text-[0.65rem] opacity-50">
        <code>SYSTEM.md</code> replaces pi's own preamble; <code>APPEND_SYSTEM.md</code> is
        added on top of whichever base applies. Both reach a running chat on
        <code>/reload</code>. Extensions add tools to Chat and load into sessions started
        afterwards, or on <code>/reload</code>; a module appears in the right pane's rail.
        A template is sent by typing <code>/name</code>. Skills are read-only here — add
        one by putting a <code>&lt;name&gt;/SKILL.md</code> directory or a
        <code>&lt;name&gt;.md</code> file in <code>~/.pi/agent/skills/</code>.
      </div>

      {#if notice}<div class="mt-2 text-xs text-success">{notice}</div>{/if}
      {#if error}<div class="mt-2 break-all text-xs text-error">{error}</div>{/if}
    </div>
  {/if}
</div>
