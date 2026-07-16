<script lang="ts">
  import { onMount } from "svelte";
  import TopBar from "./lib/TopBar.svelte";
  import WorkspacePane from "./lib/WorkspacePane.svelte";
  import Session from "./lib/Session.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import {
    activeId,
    addView,
    addWorkspace,
    closeView,
    closeWorkspace,
    focusAdjacent,
    focusAdjacentWorkspace,
    toggleCollapse,
  } from "./lib/store.ts";

  const isMac = navigator.userAgent.includes("Mac");

  // ctrl+h is a tmux-style prefix: press it to enter workspace mode, then the
  // n/w/h/l keys act on the workspace. The mode is sticky — it stays armed so you
  // can navigate repeatedly — and exits on esc, any unrecognized key, or 2s idle.
  let chordPending = $state(false);
  let chordTimer: ReturnType<typeof setTimeout> | undefined;

  function armChord() {
    chordPending = true;
    clearTimeout(chordTimer);
    chordTimer = setTimeout(() => (chordPending = false), 2000);
  }

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
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          armChord(); // stay in workspace mode and restart the idle timer
        } else {
          clearChord(); // esc or any other key exits the mode
        }
        return;
      }

      if (!mod) return;

      // ctrl+h: enter workspace mode. Swallowed from the terminal like a tmux prefix.
      if (e.code === "KeyH") {
        e.preventDefault();
        e.stopPropagation();
        armChord();
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

<div class="flex h-screen w-screen overflow-hidden bg-base-100">
  <WorkspacePane />
  <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <TopBar />
    <Session />
    <StatusBar {chordMode} />
  </main>
</div>
