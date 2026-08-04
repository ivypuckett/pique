<script lang="ts">
  import { promptBindings, type PromptInfo } from "./bindings.ts";
  import { refreshChatCommands } from "../chat/store.ts";
  // refreshPrompts() reads root's list directly, so this section needs ROOT even though
  // the Extensions one does not.
  import { ROOT } from "../scope/paths.ts";

  // Same three props as the Extensions section: the scope the module points at, whether
  // that scope is root, and the shell's refresh counter.
  let { scope, scopeIsRoot, refreshKey }: { scope: string; scopeIsRoot: boolean; refreshKey: number } =
    $props();

  // A template is inert text the user has to type the name of, so there is nothing for a
  // human to approve to themselves: editing here writes straight to live, and the pending
  // list holds agent-written ones only.
  const prompts = promptBindings();
  let ownPrompts = $state<PromptInfo[]>([]);
  let rootPrompts = $state<PromptInfo[]>([]);
  let promptError = $state("");
  let promptNotice = $state("");
  let promptBusy = $state(false);
  let openPrompt = $state<string | null>(null);
  // The edit/create form, or null when none is open. `creating` decides whether the name
  // is still editable — renaming an existing template would leave the old file behind.
  let draft = $state<
    { name: string; description: string; argumentHint: string; body: string; creating: boolean } | null
  >(null);

  const pendingPrompts = $derived(ownPrompts.filter((p) => p.state === "pending"));
  const livePrompts = $derived(ownPrompts.filter((p) => p.state === "live"));
  // Root's templates are invocable in a workspace but edited in root, so they are listed
  // here read-only. A local template of the same name shadows one of root's, which pi
  // resolves by load order (prompts/service.ts) and the label has to say.
  const inheritedPrompts = $derived(scopeIsRoot ? [] : rootPrompts.filter((p) => p.state === "live"));

  async function refreshPrompts(): Promise<void> {
    if (!prompts) return;
    try {
      ownPrompts = await prompts.promptsList({ scope });
      rootPrompts = scopeIsRoot ? [] : await prompts.promptsList({ scope: ROOT });
    } catch (e) {
      promptError = e instanceof Error ? e.message : String(e);
    }
  }

  function promptKey(p: PromptInfo): string {
    return `${p.scope}/${p.name}`;
  }

  // Same shape as the Extensions section's extAction — run, re-list, report — plus one
  // extra step: every mutation here changes what `/` offers, so the live conversations
  // re-read their menus.
  async function promptAction(run: () => Promise<unknown>, notice: string): Promise<void> {
    promptBusy = true;
    promptError = "";
    promptNotice = "";
    try {
      await run();
      openPrompt = null;
      draft = null;
      await refreshPrompts();
      refreshChatCommands();
      promptNotice = notice;
    } catch (e) {
      promptError = e instanceof Error ? e.message : String(e);
    }
    promptBusy = false;
  }

  function editPrompt(p: PromptInfo): void {
    draft = {
      name: p.name,
      description: p.description,
      argumentHint: p.argumentHint ?? "",
      body: p.body,
      creating: false,
    };
  }

  function newPrompt(): void {
    draft = { name: "", description: "", argumentHint: "", body: "", creating: true };
  }

  function saveDraft(): void {
    const d = draft;
    if (!prompts || !d) return;
    promptAction(
      () =>
        prompts.promptsSave({
          scope,
          name: d.name.trim(),
          description: d.description.trim(),
          // Absent and empty mean the same thing for a hint, so "" is not written.
          argumentHint: d.argumentHint.trim() || undefined,
          body: d.body,
        }),
      `Saved ${d.name.trim()}. Type /${d.name.trim()} in a chat to use it.`,
    );
  }

  // Re-list when the scope changes or the shell asks for a refresh — both change what
  // this list should show.
  $effect(() => {
    void refreshKey;
    if (prompts && scope) {
      promptError = "";
      promptNotice = "";
      openPrompt = null;
      refreshPrompts();
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

{#if !prompts}
  <div class="text-xs opacity-70">Available in the desktop app only.</div>
{:else}
  <div class="mt-0.5 text-xs opacity-70">
    A prompt template is a reusable message you send by typing <code>/name</code> in a
    Chat module. Arguments substitute into the text: <code>$1</code> and <code>$2</code>
    for positional, <code>$@</code> for all of them, <code>{"${1:-default}"}</code> to
    fall back when one is missing. Your own edits take effect immediately; a template an
    agent writes cannot be invoked until you read it and approve it here.
  </div>

  <div class="mt-4 mb-2 text-xs opacity-70">Awaiting review:</div>
  {#if pendingPrompts.length > 0}
    <ul class="divide-y divide-base-300 rounded border border-warning/50">
      {#each pendingPrompts as p (promptKey(p))}
        <li class="px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-mono text-xs">/{p.name}{#if p.argumentHint}<span class="opacity-50"> {p.argumentHint}</span>{/if}</div>
              {#if p.description}<div class="truncate text-[0.65rem] opacity-60">{p.description}</div>{/if}
            </div>
            <div class="flex shrink-0 gap-1">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => (openPrompt = openPrompt === promptKey(p) ? null : promptKey(p))}
              >{openPrompt === promptKey(p) ? "Hide" : "Review"}</button>
              <button
                type="button"
                class="btn btn-warning btn-xs"
                disabled={promptBusy || openPrompt !== promptKey(p)}
                title={openPrompt === promptKey(p) ? "" : "Read the text first"}
                onclick={() =>
                promptAction(
                  () => prompts.promptsApprove({ scope, name: p.name }),
                  `Approved ${p.name}. Type /${p.name} in a chat to use it.`,
                )}
              >Approve</button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                disabled={promptBusy}
                onclick={() =>
                promptAction(
                  () => prompts.promptsReject({ scope, name: p.name }),
                  `Rejected ${p.name}.`,
                )}
              >Reject</button>
            </div>
          </div>
          {#if openPrompt === promptKey(p)}
            <div class="mt-2 text-xs opacity-80">
              This text is sent as your message when you invoke it.
              {#if scopeIsRoot}Approving here makes it available in every workspace.{/if}
            </div>
            {#if p.rationale}
              <div class="mt-1.5 text-[0.65rem] opacity-70">Agent's rationale: {p.rationale}</div>
            {/if}
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

  <div class="mt-4 mb-2 flex items-center justify-between gap-2">
    <span class="text-xs opacity-70">Available:</span>
    <button type="button" class="btn btn-xs" disabled={promptBusy} onclick={newPrompt}>New</button>
  </div>

  <!-- One form for creating and editing: an existing template keeps its name,
       because saving under a new one would leave the old file behind. -->
  {#if draft}
    <div class="mb-2 rounded border border-primary/50 p-3">
      <div class="flex items-center gap-2">
        <span class="font-mono text-xs">/</span>
        <input
          class="input input-bordered input-xs flex-1 font-mono"
          placeholder="name"
          disabled={!draft.creating}
          bind:value={draft.name}
        />
        <input
          class="input input-bordered input-xs flex-1 font-mono"
          placeholder="argument hint, e.g. <file-path>"
          bind:value={draft.argumentHint}
        />
      </div>
      <input
        class="input input-bordered input-xs mt-2 w-full"
        placeholder="description — shown beside the name in the / menu"
        bind:value={draft.description}
      />
      <textarea
        class="textarea textarea-bordered mt-2 h-32 w-full font-mono text-xs leading-relaxed"
        placeholder={"The message to send. $1 for the first argument, $@ for all of them."}
        bind:value={draft.body}
      ></textarea>
      <div class="mt-2 flex justify-end gap-1">
        <button type="button" class="btn btn-ghost btn-xs" onclick={() => (draft = null)}>Cancel</button>
        <button
          type="button"
          class="btn btn-primary btn-xs"
          disabled={promptBusy || draft.name.trim() === "" || draft.body.trim() === ""}
          onclick={saveDraft}
        >Save</button>
      </div>
    </div>
  {/if}

  {#if livePrompts.length > 0}
    <ul class="max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
      {#each livePrompts as p (promptKey(p))}
        <li class="px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-mono text-xs">/{p.name}{#if p.argumentHint}<span class="opacity-50"> {p.argumentHint}</span>{/if}</div>
              {#if p.description}<div class="truncate text-[0.65rem] opacity-60">{p.description}</div>{/if}
            </div>
            <div class="flex shrink-0 gap-1">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => (openPrompt = openPrompt === promptKey(p) ? null : promptKey(p))}
              >{openPrompt === promptKey(p) ? "Hide" : "View"}</button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                disabled={promptBusy}
                onclick={() => editPrompt(p)}
              >Edit</button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                disabled={promptBusy}
                onclick={() =>
                promptAction(
                  () => prompts.promptsDelete({ scope, name: p.name, state: "live" }),
                  `Deleted ${p.name}.`,
                )}
              >Delete</button>
            </div>
          </div>
          {#if openPrompt === promptKey(p)}
            <pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
              >{p.body}</code></pre>
          {/if}
          {#if p.error}<div class="mt-1.5 break-all text-[0.65rem] text-error">{p.error}</div>{/if}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="text-xs opacity-60">None yet.</div>
  {/if}

  <!-- Root's templates are invocable here but edited in root, so they are
       read-only. A local template of the same name shadows one of these. -->
  {#if inheritedPrompts.length > 0}
    <div class="mt-4 mb-2 text-xs opacity-70">Inherited from Root:</div>
    <ul class="max-h-40 divide-y divide-base-300 overflow-y-auto rounded border border-dashed border-base-300">
      {#each inheritedPrompts as p (promptKey(p))}
        <li class="px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-mono text-xs opacity-70">/{p.name}{#if p.argumentHint}<span class="opacity-50"> {p.argumentHint}</span>{/if}</div>
              {#if p.description}<div class="truncate text-[0.65rem] opacity-60">{p.description}</div>{/if}
            </div>
            <div class="flex shrink-0 items-center gap-2">
              {#if livePrompts.some((own) => own.name === p.name)}
                <span class="text-[0.65rem] opacity-60">shadowed</span>
              {/if}
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => (openPrompt = openPrompt === promptKey(p) ? null : promptKey(p))}
              >{openPrompt === promptKey(p) ? "Hide" : "View"}</button>
            </div>
          </div>
          {#if openPrompt === promptKey(p)}
            <pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
              >{p.body}</code></pre>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if promptNotice}<div class="mt-2 text-xs text-success">{promptNotice}</div>{/if}
  {#if promptError}<div class="mt-2 break-all text-xs text-error">{promptError}</div>{/if}
{/if}
