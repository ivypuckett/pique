<script lang="ts">
  import type { PromptFileInfo } from "./prompt-bindings.ts";

  // The read-only view of one of a scope's two prompt files. Separate from the editor
  // for the reason AgentDetail gives: a create and an edit are the same form, and an
  // absent file is created through that same form rather than a third state here.
  let { file }: { file: PromptFileInfo } = $props();
</script>

<!-- What this file DOES, stated per row rather than only in the footer: the two kinds
     merge by opposite rules, and reading one row should not require having read the
     other. -->
<div class="mt-2 text-[0.65rem] opacity-70">
  {#if file.kind === "system"}
    Replaces pi's own preamble. The nearest one on the chain wins — a workspace's
    shadows root's, and only one ever applies.
  {:else}
    Added on top of whatever the base prompt turned out to be, pi's own preamble
    included. Every one on the chain applies, root's first.
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
