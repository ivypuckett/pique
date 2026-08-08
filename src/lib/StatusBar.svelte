<script lang="ts">
  import { MODULES } from "./modules/manifest.ts";

  type ChordMode = "view" | "workspace" | "pane";
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
      { key: "⏎", label: "focus" },
      { key: "esc", label: "exit" },
    ],
    workspace: [
      { key: "n", label: "new" },
      { key: "o", label: "open" },
      { key: "w", label: "close" },
      { key: "k", label: "▲" },
      { key: "j", label: "▼" },
      { key: "⏎", label: "focus" },
      { key: "esc", label: "exit" },
    ],
    pane: [
      { key: "e", label: "explorer" },
      // The modules come from the manifest, so a new one shows up here without an edit.
      ...MODULES.map((m) => ({ key: m.key, label: m.label.toLowerCase() })),
      { key: "n", label: "new" },
      { key: "w", label: "close" },
      { key: "↑↓", label: "row" },
      { key: "h", label: "◄" },
      { key: "l", label: "►" },
      { key: "1-9", label: "jump" },
      { key: "⏎", label: "focus" },
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
    <span class="flex items-center gap-1">
      <kbd class="kbd kbd-xs">{mod}T</kbd>
      <span class="opacity-70">pane</span>
    </span>
    <span class="hidden h-4 w-px bg-base-content/20 @[370px]:block"></span>
    <span class="hidden items-center gap-1 @[370px]:flex">
      <kbd class="kbd kbd-xs">{mod}B</kbd>
      <span class="opacity-70">workspaces</span>
    </span>
    <span class="hidden items-center gap-1 @[470px]:flex">
      <kbd class="kbd kbd-xs">{mod}⇧B</kbd>
      <span class="opacity-70">modules</span>
    </span>
    <span class="hidden items-center gap-1 @[560px]:flex">
      <kbd class="kbd kbd-xs">{mod},</kbd>
      <span class="opacity-70">settings</span>
    </span>
  {/if}
</footer>
