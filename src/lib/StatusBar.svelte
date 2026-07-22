<script lang="ts">
  type ChordMode = "view" | "workspace";
  let { chordMode = null }: { chordMode?: ChordMode | null } = $props();

  const isMac = navigator.userAgent.includes("Mac");
  const mod = isMac ? "⌘" : "⌃"; // ⌘ / ⌃

  // Each mode's sub-commands, revealed while its chord is armed.
  const keys: Record<ChordMode, { key: string; label: string }[]> = {
    view: [
      { key: "n", label: "new" },
      { key: "w", label: "close" },
      { key: "h", label: "◄" },
      { key: "l", label: "►" },
      { key: "esc", label: "exit" },
    ],
    workspace: [
      { key: "n", label: "new" },
      { key: "o", label: "open" },
      { key: "w", label: "close" },
      { key: "k", label: "▲" },
      { key: "j", label: "▼" },
      { key: "esc", label: "exit" },
    ],
  };
</script>

<footer class="@container flex h-7 shrink-0 items-center gap-4 overflow-hidden border-t border-base-300 bg-base-200 px-3 text-xs">
  {#if chordMode}
    <span class="rounded bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-primary-content">
      {chordMode}
    </span>
    {#each keys[chordMode] as { key, label } (key)}
      <span class="flex items-center gap-1">
        <kbd class="kbd kbd-xs">{key}</kbd>
        <span class="opacity-70">{label}</span>
      </span>
    {/each}
  {:else}
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}H</kbd>
      <span class="opacity-70">view</span>
    </span>
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}J</kbd>
      <span class="opacity-70">workspace</span>
    </span>
    <span class="hidden h-4 w-px bg-base-content/20 @[300px]:block"></span>
    <span class="hidden items-center gap-1 @[300px]:flex">
      <kbd class="kbd kbd-xs">{mod}B</kbd>
      <span class="opacity-70">left col</span>
    </span>
    <span class="hidden items-center gap-1 @[400px]:flex">
      <kbd class="kbd kbd-xs">{mod}⇧B</kbd>
      <span class="opacity-70">right col</span>
    </span>
    <span class="hidden items-center gap-1 @[490px]:flex">
      <kbd class="kbd kbd-xs">{mod},</kbd>
      <span class="opacity-70">settings</span>
    </span>
  {/if}
</footer>
