<script lang="ts">
  import { onMount } from "svelte";
  import TopBar from "./lib/TopBar.svelte";
  import Workspace from "./lib/Workspace.svelte";
  import { toggleCollapse } from "./lib/store.ts";

  const isMac = navigator.userAgent.includes("Mac");

  onMount(() => {
    function onKeydown(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.code !== "KeyB") return;
      // Capture-phase + stop so the shortcut preempts the terminal (Ctrl+B is tmux's
      // prefix); the terminal never receives the keystroke.
      e.preventDefault();
      e.stopPropagation();
      toggleCollapse(e.shiftKey ? "right" : "left");
    }
    globalThis.addEventListener("keydown", onKeydown, true);
    return () => globalThis.removeEventListener("keydown", onKeydown, true);
  });
</script>

<main class="flex h-screen w-screen flex-col overflow-hidden bg-base-100">
  <TopBar />
  <Workspace />
</main>
