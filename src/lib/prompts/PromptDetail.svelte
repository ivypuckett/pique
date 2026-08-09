<script lang="ts">
  import type { PromptInfo } from "./bindings.ts";

  // The read-only view of a template. The editor is a separate component: it opens
  // beneath the Add bar rather than inside a row, because a create and an edit are the
  // same form and a form nested in a list row is the more awkward of the two.
  let { prompt }: { prompt: PromptInfo } = $props();
</script>

{#if prompt.rationale}
  <!-- Recorded by define_prompt. Shown to the reviewer, never part of the expanded
       prompt, which is why it is not in the body. -->
  <div class="mt-1.5 text-[0.65rem] opacity-70">Agent's rationale: {prompt.rationale}</div>
{/if}
<pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
  >{prompt.body}</code></pre>
