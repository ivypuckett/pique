<script lang="ts">
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import TopBar from "./lib/TopBar.svelte";
  import WorkspacePane from "./lib/WorkspacePane.svelte";
  import Session from "./lib/Session.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import SettingsModal from "./lib/settings/SettingsModal.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import { settingsOpen } from "./lib/settings/store.ts";
  import { ROOT } from "./lib/scope/paths.ts";
  import type { WorkspaceState } from "./lib/workspace.ts";
  import {
    activeId,
    activeView,
    activeWorkspace,
    addView,
    addWorkspace,
    closeView,
    closeWorkspace,
    focusAdjacent,
    focusAdjacentWorkspace,
    setExplorerHidden,
    toggleCollapse,
    workspaceRailHidden,
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

  // The visible file tree: every view stays mounted (hidden ones via display:none), so
  // pick the one that's actually on screen — offsetParent is null inside a hidden ancestor.
  function visibleTree(): HTMLElement | null {
    const trees = document.querySelectorAll<HTMLElement>('[role="tree"][aria-label="File tree"]');
    for (const tree of trees) {
      if (tree.offsetParent !== null) return tree;
    }
    return null;
  }

  // The presented view's active tab: only its content is on screen (hidden tabs and
  // background views are display:none, so offsetParent is null).
  function focusActiveTab() {
    const panes = document.querySelectorAll<HTMLElement>("[data-tab-content]");
    for (const pane of panes) {
      if (pane.offsetParent === null) continue;
      pane.querySelector<HTMLElement>('textarea, input, [tabindex]:not([tabindex="-1"])')?.focus();
      return;
    }
  }

  // ctrl+j w: closing a workspace unmounts it — its views, tabs and running modules go
  // with it, and nothing brings them back — so it asks first. Root is never closable
  // (store's closeWorkspace no-ops on it), so it never prompts. The armed chord is
  // dropped on open: while the dialog is up every key belongs to it, not the mode.
  let pendingClose = $state<WorkspaceState | null>(null);

  function askCloseWorkspace() {
    const w = get(activeWorkspace);
    if (w.id === ROOT) return;
    clearChord();
    pendingClose = w;
  }

  // The confirm button held focus, so once the dialog goes away hand focus back to the
  // shown workspace's active tab rather than letting it fall to the body.
  async function dismissClose(close: boolean) {
    pendingClose = null;
    if (close) closeWorkspace();
    await tick();
    focusActiveTab();
  }

  // ctrl+e: cycle the explorer. Hidden (or the pane collapsed) → reveal and focus it;
  // visible but unfocused → focus it; visible and focused → hide it and hand focus to the tab.
  async function toggleFileTree() {
    const view = get(activeView);
    const focused = visibleTree()?.contains(document.activeElement) ?? false;

    if (view.right.collapsed || view.explorer.hidden) {
      if (view.right.collapsed) toggleCollapse(view.id, "right");
      if (view.explorer.hidden) setExplorerHidden(view.id, false);
      await tick();
      visibleTree()?.focus();
    } else if (focused) {
      setExplorerHidden(view.id, true);
      await tick();
      focusActiveTab();
    } else {
      visibleTree()?.focus();
    }
  }

  onMount(() => {
    // Modifier-only keydowns shouldn't cancel a pending chord.
    const MODS = new Set(["Control", "Meta", "Shift", "Alt"]);

    function onKeydown(e: KeyboardEvent) {
      // The close confirmation is modal: nothing is armed or shortcut-bound while it's
      // up, so its own keys (escape, enter, tab) reach it untouched.
      if (pendingClose) return;

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
            case "KeyW": askCloseWorkspace(); break;
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

      // ctrl+b: hide/show the workspace rail. ctrl+shift+b: collapse/expand the right pane.
      if (e.code === "KeyB") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) toggleCollapse(activeId(), "right");
        else workspaceRailHidden.update((h) => !h);
      }

      // ctrl+,: open the settings modal. A plain shortcut, not a chord — it
      // sits past the chord branch so it never arms or consumes a mode.
      if (e.code === "Comma") {
        e.preventDefault();
        e.stopPropagation();
        settingsOpen.set(true);
      }

      // ctrl+e: show/hide/focus the file explorer.
      if (e.code === "KeyE") {
        e.preventDefault();
        e.stopPropagation();
        toggleFileTree();
      }
    }
    globalThis.addEventListener("keydown", onKeydown, true);
    return () => globalThis.removeEventListener("keydown", onKeydown, true);
  });
</script>

<div class="flex h-screen w-screen overflow-hidden bg-base-100">
  {#if !$workspaceRailHidden}
    <WorkspacePane />
  {/if}
  <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <TopBar />
    <Session />
    <StatusBar {chordMode} />
  </main>
  <SettingsModal />
  <ConfirmDialog
    open={pendingClose !== null}
    label="Close"
    note="Its views, tabs and running modules close with it."
    onconfirm={() => dismissClose(true)}
    oncancel={() => dismissClose(false)}
  >
    Close <span class="font-medium">{pendingClose!.title}</span>?
  </ConfirmDialog>
</div>
