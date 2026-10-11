<script lang="ts">
  import type { PromptFileInfo } from "./system-bindings.ts";

  // The read-only view of one of the two prompt files. Separate from the editor
  // because a create and an edit are the same form, and an absent file is created
  // through that same form rather than a third state here.
  let { file }: { file: PromptFileInfo } = $props();
</script>

<!-- What this file DOES, stated per row rather than only in the footer, so reading one
     row does not require having read the other. -->
<div class="mt-2 text-[0.65rem] opacity-70">
  {#if file.kind === "system"}
    Replaces pi's own preamble. In a trusted project, its own
    <code>.pi/SYSTEM.md</code> takes precedence over this one.
  {:else}
    Added on top of whatever the base prompt turned out to be, pi's own preamble
    included. In a trusted project, its own <code>.pi/APPEND_SYSTEM.md</code> takes
    precedence over this one.
  {/if}
</div>
<div class="mt-1 break-all font-mono text-[0.65rem] opacity-50">{file.path}</div>

{#if file.body === undefined}
  <div class="mt-1.5 text-xs opacity-60">
    No file here. Edit to create one.
  </div>
{:else}
  <pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
    >{file.body}</code></pre>
{/if}
