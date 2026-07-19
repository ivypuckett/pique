<script lang="ts">
  import { onMount } from "svelte";
  import TopBar from "./lib/TopBar.svelte";
  import WorkspacePane from "./lib/WorkspacePane.svelte";
  import Session from "./lib/Session.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import SettingsModal from "./lib/settings/SettingsModal.svelte";
  import { settingsOpen } from "./lib/settings/store.ts";
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
  import { pickDirectory } from "./lib/settings/bindings.ts";

  // ctrl+j o: pick a folder, then open a new workspace seeded with it. Picking is
  // async (native dialog); on cancel — or in a browser tab, where there's no picker —
  // pickDirectory resolves null and no workspace is created.
  async function openWorkspaceFromPicker(): Promise<void> {
    const dir = await pickDirectory();
    if (dir) addWorkspace(dir);
  }

  const isMac = navigator.userAgent.includes("Mac");

  // ctrl+h / ctrl+j are tmux-style prefixes: press one to enter a mode, then its keys act
  // on views (h/l) or workspaces (j/k). A mode is sticky — it stays armed so you can
  // navigate repeatedly — and exits on esc, any unrecognized key, or 2s idle.
  type ChordMode = "view" | "workspace";
  let chordMode = $state<ChordMode | null>(null);
  let chordTimer: ReturnType<typeof setTimeout> | undefined;

  function armChord(mode: ChordMode) {
    chordMode = mode;
    clearTimeout(chordTimer);
    chordTimer = setTimeout(() => (chordMode = null), 2000);
  }

  function clearChord() {
    clearTimeout(chordTimer);
    chordMode = null;
  }

  onMount(() => {
    // Modifier-only keydowns shouldn't cancel a pending chord.
    const MODS = new Set(["Control", "Meta", "Shift", "Alt"]);

    function onKeydown(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // A prefix pressed while a mode is armed switches modes rather than counting as an
      // unrecognized key, so ctrl+j then ctrl+h lands in view mode.
      if (mod && (e.code === "KeyH" || e.code === "KeyJ")) {
        e.preventDefault();
        e.stopPropagation();
        armChord(e.code === "KeyH" ? "view" : "workspace");
        return;
      }

      // Second stroke of the chord. Capture-phase + stop keeps it away from the terminal.
      if (chordMode) {
        if (MODS.has(e.key)) return;
        const mode = chordMode;
        let handled = true;
        if (mode === "view") {
          switch (e.code) {
            case "KeyN": addView(); break;
            case "KeyW": closeView(); break;
            case "KeyH": focusAdjacent(-1); break;
            case "KeyL": focusAdjacent(1); break;
            default: handled = false;
          }
        } else {
          switch (e.code) {
            case "KeyN": addWorkspace(); break;
            case "KeyO": openWorkspaceFromPicker(); break;
            case "KeyW": closeWorkspace(); break;
            case "KeyK": focusAdjacentWorkspace(-1); break;
            case "KeyJ": focusAdjacentWorkspace(1); break;
            default: handled = false;
          }
        }
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          armChord(mode); // stay in the mode and restart the idle timer
        } else {
          clearChord(); // esc or any other key exits the mode
        }
        return;
      }

      if (!mod) return;

      // ctrl+b: toggle a side column of the presented view (shift = right).
      if (e.code === "KeyB") {
        e.preventDefault();
        e.stopPropagation();
        toggleCollapse(activeId(), e.shiftKey ? "right" : "left");
      }

      // ctrl+,: open the settings modal. A plain shortcut, not a chord — it
      // sits past the chord branch so it never arms or consumes a mode.
      if (e.code === "Comma") {
        e.preventDefault();
        e.stopPropagation();
        settingsOpen.set(true);
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
  <SettingsModal />
</div>
