<script lang="ts">
  import type { AgentDef } from "./bindings.ts";

  // The read-only view of a subagent definition. The editor is a separate component,
  // for the reason PromptDetail gives: a create and an edit are the same form, and a
  // form nested in a list row is the more awkward of the two places to put it.
  let { agent }: { agent: AgentDef } = $props();
</script>

<!-- Both of these are what the definition ASKS for, and both fall back silently at run
     time — an omitted tools list means pi's base set, and a model that is not available
     falls back to the parent conversation's (agents/service.ts). The row says which case
     it is in rather than leaving a blank line to read as either. -->
<div class="mt-2 flex flex-wrap items-center gap-1 text-[0.65rem]">
  <span class="opacity-60">tools</span>
  {#if agent.tools && agent.tools.length > 0}
    {#each agent.tools as t (t)}
      <span class="badge badge-ghost badge-xs font-mono">{t}</span>
    {/each}
  {:else}
    <span class="opacity-60">pi's default set</span>
  {/if}
  <span class="ml-2 opacity-60">model</span>
  <span class="font-mono opacity-80">{agent.model ?? "inherits this conversation's"}</span>
</div>

<pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
  >{agent.systemPrompt}</code></pre>
