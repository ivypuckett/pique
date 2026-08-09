<script lang="ts">
  import type { ExtensionSource } from "./bindings.ts";

  // Presentation only. Library.svelte does the extensionsRead and keeps the digest it
  // returned, so the bytes handed to extensionsEnable are provably the bytes shown here
  // — splitting the read across this boundary would make the gate prove nothing.
  //
  // One pane for both origins: a local module is always a single file, a package is
  // however many entry files pi resolved for it, and it is the code that is the artifact
  // either way.
  let { source }: { source: ExtensionSource } = $props();
</script>

{#each source.files as f (f.path)}
  <div class="mt-2 truncate font-mono text-[0.65rem] opacity-60" title={f.path}>{f.path}</div>
  <pre class="mt-1 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
    >{f.text}</code></pre>
{/each}

{#if source.files.length === 0}
  <div class="mt-2 text-xs opacity-60">
    No extension entry files — this package ships skills or prompts only.
  </div>
{/if}

{#if source.skills.length > 0}
  <div class="mt-2 text-xs opacity-70">
    Also ships {source.skills.length}
    skill{source.skills.length === 1 ? "" : "s"} — not code, but their text reaches
    the agent:
  </div>
  <ul class="mt-1 max-h-24 overflow-y-auto text-[0.65rem] opacity-60">
    {#each source.skills as sk (sk)}
      <li class="truncate font-mono" title={sk}>{sk}</li>
    {/each}
  </ul>
{/if}

{#if source.truncated}
  <div class="mt-1 text-[0.65rem] text-warning">
    Long file truncated for display — read it on disk before enabling.
  </div>
{/if}
