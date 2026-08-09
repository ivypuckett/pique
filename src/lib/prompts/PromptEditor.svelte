<script lang="ts">
  import type { Draft } from "./items.ts";

  // One form for creating and editing: an existing template keeps its name, because
  // saving under a new one would leave the old file behind.
  //
  // `draft` is bindable rather than owned here so the shell can discard it on a scope
  // switch — a draft belongs to the scope it was started in.
  let {
    draft = $bindable(),
    busy,
    onsave,
    oncancel,
  }: {
    draft: Draft;
    busy: boolean;
    onsave: () => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="mb-2 rounded border border-primary/50 p-3">
  <div class="flex items-center gap-2">
    <span class="font-mono text-xs">/</span>
    <input
      class="input input-bordered input-xs flex-1 font-mono"
      placeholder="name"
      aria-label="Template name"
      disabled={!draft.creating}
      bind:value={draft.name}
    />
    <input
      class="input input-bordered input-xs flex-1 font-mono"
      placeholder="argument hint, e.g. <file-path>"
      aria-label="Argument hint"
      bind:value={draft.argumentHint}
    />
  </div>
  <input
    class="input input-bordered input-xs mt-2 w-full"
    placeholder="description — shown beside the name in the / menu"
    aria-label="Description"
    bind:value={draft.description}
  />
  <textarea
    class="textarea textarea-bordered mt-2 h-32 w-full font-mono text-xs leading-relaxed"
    placeholder={"The message to send. $1 for the first argument, $@ for all of them."}
    aria-label="Template body"
    bind:value={draft.body}
  ></textarea>
  <div class="mt-2 flex justify-end gap-1">
    <button type="button" class="btn btn-ghost btn-xs" onclick={oncancel}>Cancel</button>
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={busy || draft.name.trim() === "" || draft.body.trim() === ""}
      onclick={onsave}
    >Save</button>
  </div>
</div>
