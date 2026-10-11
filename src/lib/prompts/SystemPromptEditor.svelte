<script lang="ts">
  import { PROMPT_FILE_NAMES, type PromptFileDraft } from "./system-items.ts";

  // One form for both kinds and for both creating and editing — there is exactly one
  // file of each kind, so `kind` is the identity and there is nothing to name.
  //
  // `draft` is bindable rather than owned here so the shell can discard it.
  let {
    draft = $bindable(),
    busy,
    onsave,
    oncancel,
  }: {
    draft: PromptFileDraft;
    busy: boolean;
    onsave: () => void;
    oncancel: () => void;
  } = $props();

  // Saving nothing DELETES the file (prompts/system.ts says why), so the button has to say
  // so — otherwise clearing the box and pressing Save looks like it failed to write.
  const clearing = $derived(draft.body.trim() === "");
</script>

<div class="mb-2 rounded border border-primary/50 p-3">
  <div class="flex items-center gap-2">
    <span class="badge badge-ghost badge-xs">{draft.kind}</span>
    <span class="font-mono text-xs">{PROMPT_FILE_NAMES[draft.kind]}</span>
    <span class="text-[0.65rem] opacity-60">
      {draft.kind === "system"
        ? "Replaces pi's own preamble."
        : "Added on top of whichever base prompt applies."}
    </span>
  </div>
  <textarea
    class="textarea textarea-bordered mt-2 h-48 w-full font-mono text-xs leading-relaxed"
    placeholder={draft.kind === "system"
      ? "The whole system prompt, in place of pi's own."
      : "Added to every agent — house rules."}
    aria-label={PROMPT_FILE_NAMES[draft.kind]}
    bind:value={draft.body}
  ></textarea>
  <div class="mt-2 flex items-center justify-end gap-2">
    {#if clearing}
      <span class="text-[0.65rem] opacity-60">
        Empty — saving deletes the file.
      </span>
    {/if}
    <button type="button" class="btn btn-ghost btn-xs" onclick={oncancel}>Cancel</button>
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={busy}
      onclick={onsave}
    >{clearing ? "Clear" : "Save"}</button>
  </div>
</div>
