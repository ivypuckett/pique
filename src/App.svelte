<script lang="ts">
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import TopBar from "./lib/TopBar.svelte";
  import WorkspacePane from "./lib/WorkspacePane.svelte";
  import Session from "./lib/Session.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import SettingsModal from "./lib/settings/SettingsModal.svelte";
  import ConfirmDialog from "./lib/ConfirmDialog.svelte";
  import { settings, settingsOpen, stepZoom } from "./lib/settings/store.ts";
  import { DEFAULT_SETTINGS } from "./lib/settings/bindings.ts";
  import { ROOT } from "./lib/scope/paths.ts";
  import { activeTabId, EDITOR } from "./lib/layout.ts";
  import type { WorkspaceState } from "./lib/workspace.ts";
  import {
    activeView,
    activeWorkspace,
    addView,
    addWorkspace,
    closeActiveTab,
    closeView,
    closeWorkspace,
    focusAdjacent,
    focusAdjacentGroup,
    focusAdjacentTab,
    focusAdjacentWorkspace,
    focusTabAt,
    moduleRailHidden,
    newTab,
    selectGroup,
    workspaceRailHidden,
  } from "./lib/store.ts";
  import { MODULES } from "./lib/modules/manifest.ts";

  // ctrl+j o: open a new workspace and put the caret in its directory box (TopBar's
  // PathInput), which starts at the directory the workspace inherits from root. The
  // picker IS that box, so there is nothing to cancel — esc just leaves the new
  // workspace on the inherited directory. Found by aria-label for the same reason
  // visibleChatInput below is: the box lives in a component this one doesn't reach into.
  async function openWorkspaceFromPicker(): Promise<void> {
    addWorkspace();
    await tick();
    document
      .querySelector<HTMLInputElement>(
        'input[aria-label="Working directory for new modules in this workspace"]',
      )
      ?.focus();
  }

  const isMac = navigator.userAgent.includes("Mac");

  // ctrl+h / ctrl+j / ctrl+t are tmux-style prefixes: press one to enter a mode, then its
  // keys act on views (h/l), workspaces (j/k) or the right pane (a letter picks a rail row,
  // n opens one more of it, h/l and 1-9 move along its tab strip, the arrows move up and
  // down the rail, w closes). Navigation is sticky — the mode stays armed so you can move
  // repeatedly — and exits on esc, any unrecognized key, or 2s idle. Opening or showing
  // something exits immediately instead, so the first key you type into it isn't eaten.
  type ChordMode = "view" | "workspace" | "pane";
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

  // The visible chat's message box. Same reason visibleTree walks a list: every view of
  // every workspace keeps its chat mounted, so the one on screen is the one with a
  // layout box. Chat is the center column of every view and has no hidden state, so
  // there is always exactly one.
  function visibleChatInput(): HTMLElement | null {
    // Matched on the label alone, not on a tag: the box is a textarea so it can grow
    // with what you type, and pinning the selector to one element name is what would
    // silently break this the next time that changes.
    const inputs = document.querySelectorAll<HTMLElement>('[aria-label="Chat message"]');
    for (const input of inputs) {
      if (input.offsetParent !== null) return input;
    }
    return null;
  }

  // ctrl+shift+m: put the caret in the message box, from wherever you were. One-way on
  // purpose, unlike ctrl+shift+e — the way back is whatever you came from, and the chat
  // column is always on screen, so there is nothing to reveal first.
  //
  // m for the box's own "Message…", and not c: the webview keeps ctrl+shift+c for copy,
  // which a terminal tab needs since ctrl+c there is the interrupt. Shifted for the
  // reason ctrl+shift+e is — the capture-phase listener swallows whatever it binds, and
  // a bare ctrl+m is the return key (^M) to anything running in a terminal.
  function focusChat() {
    visibleChatInput()?.focus();
  }

  // The presented view's active tab: only its content is on screen (hidden tabs and
  // background views are display:none, so offsetParent is null) — and a module can keep
  // several panes mounted itself — Library hides its inactive sub-tab — so the same test
  // has to filter the candidates, not just the pane.
  function focusActiveTab() {
    const panes = document.querySelectorAll<HTMLElement>("[data-tab-content]");
    for (const pane of panes) {
      if (pane.offsetParent === null) continue;
      [...pane.querySelectorAll<HTMLElement>(
        'textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].find((el) => el.offsetParent !== null)?.focus();
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

  // ctrl+t e: show the editor row and put the caret in the tree. The tree is that row's
  // content, so there is nothing to toggle. Focusing it is an explicit step — settleFocus
  // only ever hands focus to a terminal.
  async function showEditor() {
    onTabs((id) => selectGroup(id, EDITOR));
    await tick();
    visibleTree()?.focus();
  }

  // ctrl+shift+e: the round trip between the tree and the file you are editing, in one
  // key. Opening a file already lands the caret in it (addEditorTab sets autoFocus), so
  // this is the way back — and pressing it again in the tree returns you to the tab you
  // came from, which is why it is a plain shortcut and not another ctrl+t stroke.
  //
  // Shifted deliberately: an editor tab is $EDITOR in a terminal, and the capture-phase
  // listener swallows whatever it binds, so a bare ctrl+e would take vim's scroll-by-a-
  // line away in the one place this shortcut is for.
  //
  // Nothing open beside the tree means nothing to go back to: focusActiveTab finds no
  // shown pane and the caret stays put.
  function toggleEditorFocus() {
    const tree = visibleTree();
    if (tree?.contains(document.activeElement)) focusActiveTab();
    else showEditor();
  }

  // Every chord stroke changes what is on screen, so every one of them ends here: take
  // the caret out of a pane that is no longer shown, and hand it to a terminal that now
  // is. Without the first half, switching view, workspace or tab leaves you typing into
  // a shell you can't see; without the second, a terminal you just opened needs a click
  // before it will take a keystroke.
  //
  // Terminals only. focusActiveTab picks a pane's first focusable element, which for a
  // terminal is xterm's textarea but for kanban is the first column's rename field — so
  // focusing every module would turn a stray keystroke after ctrl+t k into a renamed
  // column. The rest keep focus wherever it already was.
  async function settleFocus() {
    await tick();
    if (pendingClose) return; // the dialog owns focus while it is up
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.closest("[data-tab-content]") && el.offsetParent === null) {
      el.blur();
    }
    const view = get(activeView);
    const shown = view.right.tabs.find((t) => t.id === activeTabId(view));
    if (shown?.kind === "terminal") focusActiveTab();
  }

  // ctrl+t's strokes all act on the pane of whichever view is on screen. Hiding the module
  // rail hides the list, not the pane, so there is never anything to reveal first: the row
  // a stroke selects is on screen either way.
  function onTabs(act: (viewId: string) => void) {
    act(get(activeView).id);
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
      const PREFIXES: Record<string, ChordMode> = {
        KeyH: "view",
        KeyJ: "workspace",
        KeyT: "pane",
      };
      if (mod && PREFIXES[e.code]) {
        e.preventDefault();
        e.stopPropagation();
        armChord(PREFIXES[e.code]);
        return;
      }

      // Second stroke of the chord. Capture-phase + stop keeps it away from the terminal.
      if (chordMode) {
        if (MODS.has(e.key)) return;
        const mode = chordMode;

        // Enter means "take me to what is on screen now" in every mode: settle focus and
        // leave. It has to be a key the modes recognise — an unrecognised one exits
        // without swallowing the stroke, and the stroke then lands wherever focus is,
        // which after a chord is often a terminal that would run its command line.
        if (e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          e.stopPropagation();
          settleFocus();
          clearChord();
          return;
        }

        let handled = true;
        let sticky = true; // cleared by the strokes that open a tab
        // Cleared by the strokes that place the caret themselves: settleFocus would
        // otherwise hand it straight back to the terminal of the workspace they opened.
        let settle = true;
        if (mode === "view") {
          switch (e.code) {
            case "KeyN": addView(); break;
            case "KeyW": closeView(); break;
            case "KeyH": focusAdjacent(-1); break;
            case "KeyL": focusAdjacent(1); break;
            default: handled = false;
          }
        } else if (mode === "workspace") {
          switch (e.code) {
            case "KeyN": addWorkspace(); break;
            case "KeyO": openWorkspaceFromPicker(); settle = false; break;
            case "KeyW": askCloseWorkspace(); break;
            case "KeyK": focusAdjacentWorkspace(-1); break;
            case "KeyJ": focusAdjacentWorkspace(1); break;
            default: handled = false;
          }
        } else {
          const digit = /^Digit([1-9])$/.exec(e.code);
          if (digit) {
            // 1-9 shows that tab of the selected row, counting from the left. Navigation
            // like h/l below, so it keeps the mode armed; a digit past the end of the
            // strip does nothing.
            onTabs((id) => focusTabAt(id, Number(digit[1])));
          } else {
            // A module's own letter shows its row, opening the module if that row is
            // empty; the manifest is the only place those letters are written down. None
            // of them collides with the navigation keys below.
            const def = MODULES.find((m) => e.code === `Key${m.key.toUpperCase()}`);
            sticky = false;
            if (def) {
              onTabs((id) => selectGroup(id, def.kind));
            } else {
              switch (e.code) {
                // e is the editor's letter — it has no module, so it is not in the
                // manifest — and n is one more of whatever row you are on.
                case "KeyE": showEditor(); break;
                case "KeyN": onTabs((id) => newTab(id)); break;
                // w closes, h/l move along the strip and the arrows move up and down the
                // rail, rather than opening anything — so all of them keep the mode armed,
                // the way view and workspace navigation does.
                case "KeyW": onTabs(() => closeActiveTab()); sticky = true; break;
                case "KeyH": onTabs((id) => focusAdjacentTab(id, -1)); sticky = true; break;
                case "KeyL": onTabs((id) => focusAdjacentTab(id, 1)); sticky = true; break;
                // Arrows, not j/k: every rail row has a letter of its own, and k is
                // already Kanban's.
                case "ArrowUp": onTabs((id) => focusAdjacentGroup(id, -1)); sticky = true; break;
                case "ArrowDown": onTabs((id) => focusAdjacentGroup(id, 1)); sticky = true; break;
                default: handled = false;
              }
            }
          }
        }
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          if (settle) settleFocus();
          if (sticky) armChord(mode); // stay in the mode and restart the idle timer
          else clearChord();
        } else {
          clearChord(); // esc or any other key exits the mode
        }
        return;
      }

      if (!mod) return;

      // ctrl+b: hide/show the workspace rail. ctrl+shift+b: the same for the module rail.
      if (e.code === "KeyB") {
        e.preventDefault();
        e.stopPropagation();
        const rail = e.shiftKey ? moduleRailHidden : workspaceRailHidden;
        rail.update((h) => !h);
      }

      // ctrl+shift+e: hop between the file tree and the file open beside it. Plain
      // ctrl+e stays unbound — see toggleEditorFocus.
      if (e.code === "KeyE" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleEditorFocus();
      }

      // ctrl+shift+m: put the caret in the chat's message box — see focusChat.
      if (e.code === "KeyM" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        focusChat();
      }

      // ctrl+,: open the settings modal. A plain shortcut, not a chord — it
      // sits past the chord branch so it never arms or consumes a mode.
      if (e.code === "Comma") {
        e.preventDefault();
        e.stopPropagation();
        settingsOpen.set(true);
      }

      // ctrl+= / ctrl+- / ctrl+0: zoom the UI in, out, or back to 100%. The webview
      // brings no zoom of its own, so this is the only way to scale the app. Codes,
      // not keys: ctrl+shift+= is how "+" is typed on most layouts, and reading the
      // key there would see "+" on one keyboard and "=" on another.
      if (e.code === "Equal" || e.code === "Minus" || e.code === "Digit0") {
        e.preventDefault();
        e.stopPropagation();
        const zoom = (current: number) =>
          e.code === "Digit0"
            ? DEFAULT_SETTINGS.appearance.zoom
            : stepZoom(current, e.code === "Equal" ? 1 : -1);
        settings.update((s) => ({
          ...s,
          appearance: { ...s.appearance, zoom: zoom(s.appearance.zoom) },
        }));
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
