<script lang="ts">
  import type { Draft } from "./items.ts";

  // One form for creating and editing: an existing definition keeps its name, because
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
    <input
      class="input input-bordered input-xs flex-1 font-mono"
      placeholder="name, e.g. scout"
      aria-label="Subagent name"
      disabled={!draft.creating}
      bind:value={draft.name}
    />
    <!-- Both optional, and both fall back rather than failing: an empty tools list gives
         pi's base set, an empty model inherits the parent conversation's. -->
    <input
      class="input input-bordered input-xs flex-1 font-mono"
      placeholder="tools, e.g. read, grep, ls — blank for the default set"
      aria-label="Tools"
      bind:value={draft.tools}
    />
    <input
      class="input input-bordered input-xs flex-1 font-mono"
      placeholder="model — blank to inherit"
      aria-label="Model"
      bind:value={draft.model}
    />
  </div>
  <input
    class="input input-bordered input-xs mt-2 w-full"
    placeholder="description — what the calling agent reads when choosing this one"
    aria-label="Description"
    bind:value={draft.description}
  />
  <textarea
    class="textarea textarea-bordered mt-2 h-32 w-full font-mono text-xs leading-relaxed"
    placeholder={"The subagent's system prompt: who it is and how it should approach a task."}
    aria-label="System prompt"
    bind:value={draft.systemPrompt}
  ></textarea>
  <div class="mt-2 flex justify-end gap-1">
    <button type="button" class="btn btn-ghost btn-xs" onclick={oncancel}>Cancel</button>
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={busy || draft.name.trim() === "" || draft.systemPrompt.trim() === ""}
      onclick={onsave}
    >Save</button>
  </div>
</div>
