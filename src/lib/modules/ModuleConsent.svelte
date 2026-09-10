<script lang="ts">
  // What a module is asking for, in the plainest words available, shown before it can
  // run. The broker is what actually holds these grants (modules/capabilities.ts); this
  // is the half that makes them a decision rather than a fact the user learns later.
  //
  // Two things are stated here that a reader would otherwise have to know already: that
  // a module cannot reach the network at all, and that these grants are the whole list.
  // Both are properties of the design that the row would otherwise leave the user to
  // guess at, and guessing wrong in the safe direction still means not installing
  // something they could have used.
  import type { ModuleCapabilities } from "./bindings.ts";

  let { capabilities, name }: { capabilities: ModuleCapabilities; name: string } = $props();

  // Ordered by how much a person should care, not by how the JSON is written.
  const lines = $derived([
    ...(capabilities.fs?.write?.length
      ? [{ risk: true, text: `Write files under: ${capabilities.fs.write.join(", ")}` }]
      : []),
    ...(capabilities.fs?.read?.length
      ? [{ risk: true, text: `Read files under: ${capabilities.fs.read.join(", ")}` }]
      : []),
    ...(capabilities.kanban ? [{ risk: false, text: "Read this scope's kanban board" }] : []),
    ...(capabilities.storage ? [{ risk: false, text: "Keep its own saved data" }] : []),
  ]);
</script>

<div class="flex flex-col gap-2 text-sm">
  <div class="opacity-70">
    <span class="font-mono">{name}</span> runs its own code in a sandboxed frame. It can do
    only what you allow here:
  </div>

  {#if lines.length === 0}
    <div class="opacity-60">Nothing — it can only draw its panel.</div>
  {:else}
    <ul class="ml-4 list-disc">
      {#each lines as line}
        <li class:text-warning={line.risk}>{line.text}</li>
      {/each}
    </ul>
  {/if}

  <!-- Not a reassurance to skim past: it is the one guarantee the frame cannot break,
       and it is why the list above is the whole story. -->
  <div class="opacity-60">
    It cannot reach the network, cannot see the rest of pique, and cannot read anything
    outside the paths listed above.
  </div>
</div>
