<script lang="ts">
  import type { PromptInfo } from "./bindings.ts";

  // The read-only view of a template. The editor is a separate component: it opens
  // beneath the Add bar rather than inside a row, because a create and an edit are the
  // same form and a form nested in a list row is the more awkward of the two.
  let { prompt }: { prompt: PromptInfo } = $props();
</script>

<pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
  >{prompt.body}</code></pre>
