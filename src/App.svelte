<script lang="ts">
  import { onMount } from "svelte";
  import TopBar from "./lib/TopBar.svelte";
  import Workspace from "./lib/Workspace.svelte";
  import { activeId, addView, closeView, focusAdjacent, toggleCollapse } from "./lib/store.ts";

  const isMac = navigator.userAgent.includes("Mac");

  // ctrl+h is a tmux-style prefix: press it, then a second key acts on the workspace.
  // While pending we show a hint and swallow the second key from the modules below.
  let chordPending = $state(false);
  let chordTimer: ReturnType<typeof setTimeout> | undefined;

  function clearChord() {
    clearTimeout(chordTimer);
    chordPending = false;
  }

  onMount(() => {
    // Modifier-only keydowns shouldn't cancel a pending chord.
    const MODS = new Set(["Control", "Meta", "Shift", "Alt"]);

    function onKeydown(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Second stroke of the chord. Capture-phase + stop keeps it away from the terminal.
      if (chordPending) {
        if (MODS.has(e.key)) return;
        let handled = true;
        switch (e.code) {
          case "KeyN": addView(); break;
          case "KeyW": closeView(); break;
          case "KeyH": focusAdjacent(-1); break;
          case "KeyL": focusAdjacent(1); break;
          default: handled = false;
        }
        clearChord();
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (!mod) return;

      // ctrl+h: start the chord. Swallowed from the terminal like a tmux prefix.
      if (e.code === "KeyH") {
        e.preventDefault();
        e.stopPropagation();
        chordPending = true;
        clearTimeout(chordTimer);
        chordTimer = setTimeout(() => (chordPending = false), 2000);
        return;
      }

      // ctrl+b: toggle a side column of the presented view (shift = right).
      if (e.code === "KeyB") {
        e.preventDefault();
        e.stopPropagation();
        toggleCollapse(activeId(), e.shiftKey ? "right" : "left");
      }
    }
    globalThis.addEventListener("keydown", onKeydown, true);
    return () => globalThis.removeEventListener("keydown", onKeydown, true);
  });
</script>

<main class="flex h-screen w-screen flex-col overflow-hidden bg-base-100">
  <TopBar {chordPending} />
  <Workspace />
</main>
