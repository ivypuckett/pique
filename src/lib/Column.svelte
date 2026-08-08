<script lang="ts">
  import { resizeBoundary, setExplorerHidden, toggleCollapse } from "./store.ts";
  import {
    type ColumnId,
    type ColumnState,
    EXPLORER,
    type ExplorerState,
    moduleLabel,
    type RightState,
    SPLITTER_PX,
    trackPair,
  } from "./layout.ts";
  import { chPx } from "./ch.ts";
  import ModuleFrame from "./ModuleFrame.svelte";
  import ModuleRail from "./ModuleRail.svelte";
  import Splitter from "./Splitter.svelte";
  import TabStrip from "./TabStrip.svelte";
  import { moduleDef } from "./modules/manifest.ts";
  import { registry } from "./modules/registry.ts";

  // `id` says which of the two shapes is passed: "center" carries the chat column, "right"
  // the tabbed pane. The two branches share nothing but the module frame, so they take
  // their own state rather than a common one.
  let { viewId, col, right, id, explorer, cwd, workspaceId, el = $bindable() }: {
    viewId: string;
    col?: ColumnState;
    right?: RightState;
    id: ColumnId;
    explorer?: ExplorerState;
    cwd?: string;
    workspaceId?: string;
    el?: HTMLElement;
  } = $props();

  const FileTree = registry["filetree"];
  let bodyEl: HTMLElement | undefined = $state();

  // What an empty rail row says. A module row names the chord that opens one; the
  // explorer's tabs only ever come from the tree, so it points there instead.
  const mod = navigator.userAgent.includes("Mac") ? "⌘" : "⌃";

  function emptyHint(group: string): string {
    if (group === EXPLORER) return "No files open — open one from the file tree.";
    const def = moduleDef(group);
    return def
      ? `No ${def.label} open — press ${mod}T ${def.key.toUpperCase()}.`
      : "Nothing open.";
  }

  // Inner splitter between the explorer and the tab content; the explorer is its left
  // column, sized in ch, so the pointer's px are converted through one character's width.
  function onExplorerDrag(clientX: number) {
    if (!bodyEl) return;
    const flexPx = bodyEl.clientWidth - SPLITTER_PX;
    const ch = chPx(bodyEl);
    if (flexPx <= 0 || ch <= 0) return;
    const left = bodyEl.getBoundingClientRect().left;
    resizeBoundary(viewId, "explorer-tabs", (clientX - left) / ch, flexPx / ch);
  }
</script>

{#if id === "center"}
  <!-- Center is always the chat pane: a single fixed module, no tab strip. Rendered
       independently of col.rows so a stale/empty persisted center can't blank it out. -->
  {@const Chat = registry["chat"]}
  <div class="flex h-full min-w-0 flex-col" bind:this={el}>
    <div class="relative min-h-0 flex-1">
      <div class="absolute inset-0">
        <ModuleFrame title="Chat" header={false}>
          <Chat title="Chat" {cwd} {workspaceId} {viewId} tabId="center-1" />
        </ModuleFrame>
      </div>
    </div>
  </div>
{:else}
  <!-- Right pane: the module rail down its right edge picks the row; the tab strip along
       the top lists that row's tabs. Below the strip the file explorer is still a sticky
       addon (full height, no frame) docked at the left edge — moving it into the explorer
       row is the next step. -->
  {@const hidden = explorer?.hidden ?? true}
  {@const pane = right!}
  {@const shown = pane.activeTabs[pane.activeGroup] ?? ""}
  <div class="flex h-full min-w-0">
    <div class="flex min-w-0 flex-1 flex-col">
      <TabStrip
        {viewId}
        right={pane}
        explorerHidden={hidden}
        onToggleExplorer={() => setExplorerHidden(viewId, !hidden)}
        onCollapse={() => toggleCollapse(viewId, "right")}
      />
      <div
        class="grid min-h-0 min-w-0 flex-1 grid-rows-1"
        style:grid-template-columns={hidden ? "1fr" : trackPair(explorer!.widthCh)}
        bind:this={bodyEl}
      >
        {#if !hidden}
          <div class="min-w-0 overflow-hidden">
            <FileTree title="Files" {cwd} {workspaceId} {viewId} tabId="explorer" />
          </div>
          <Splitter onDrag={onExplorerDrag} />
        {/if}
        <div class="relative min-w-0">
          <!-- Every open tab of every group stays mounted, so a terminal keeps running while
               you work in another module; only the selected group's shown one is visible. -->
          {#each pane.tabs as tab (tab.id)}
            {@const Module = registry[tab.kind]}
            <div class="absolute inset-0" class:hidden={tab.id !== shown} data-tab-content>
              <ModuleFrame title={tab.title} header={false}>
                {#if Module}
                  <Module title={tab.title} {cwd} {workspaceId} {viewId} tabId={tab.id} {...tab.props} />
                {:else}
                  <div class="text-sm opacity-60">
                    Unknown module: <span class="font-mono">{tab.kind}</span>
                  </div>
                {/if}
              </ModuleFrame>
            </div>
          {/each}
          <!-- A row whose last tab was closed keeps the selection rather than jumping
               somewhere else, so it needs something to show. -->
          {#if shown === ""}
            <div class="absolute inset-0 grid place-items-center p-4 text-center text-sm opacity-60">
              {emptyHint(pane.activeGroup)}
            </div>
          {/if}
        </div>
      </div>
    </div>
    <ModuleRail {viewId} right={pane} />
  </div>
{/if}
