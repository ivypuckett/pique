<script lang="ts">
  let { chordPending = false }: { chordPending?: boolean } = $props();

  const isMac = navigator.userAgent.includes("Mac");
  const mod = isMac ? "⌘" : "⌃"; // ⌘ / ⌃

  // The workspace group's sub-commands, revealed while the ctrl+h chord is armed.
  const workspaceKeys = [
    { key: "n", label: "new" },
    { key: "w", label: "close" },
    { key: "h", label: "◄" },
    { key: "l", label: "►" },
    { key: "esc", label: "exit" },
  ];
</script>

<footer class="flex h-7 shrink-0 items-center gap-4 border-t border-base-300 bg-base-200 px-3 text-xs">
  {#if chordPending}
    <span class="rounded bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-primary-content">
      workspace
    </span>
    {#each workspaceKeys as { key, label } (key)}
      <span class="flex items-center gap-1">
        <kbd class="kbd kbd-xs">{key}</kbd>
        <span class="opacity-70">{label}</span>
      </span>
    {/each}
  {:else}
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}H</kbd>
      <span class="opacity-70">workspace</span>
    </span>
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}B</kbd>
      <span class="opacity-70">columns</span>
    </span>
  {/if}
</footer>
