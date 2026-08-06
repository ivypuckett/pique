<script lang="ts">
  import { resizeBoundary, setExplorerHidden, toggleCollapse } from "./store.ts";
  import {
    type ColumnId,
    type ColumnState,
    type ExplorerState,
    SPLITTER_PX,
    trackPair,
  } from "./layout.ts";
  import { chPx } from "./ch.ts";
  import ModuleFrame from "./ModuleFrame.svelte";
  import Splitter from "./Splitter.svelte";
  import TabStrip from "./TabStrip.svelte";
  import { registry } from "./modules/registry.ts";

  let { viewId, col, id, explorer, cwd, workspaceId, el = $bindable() }: {
    viewId: string;
    col: ColumnState;
    id: ColumnId;
    explorer?: ExplorerState;
    cwd?: string;
    workspaceId?: string;
    el?: HTMLElement;
  } = $props();

  const FileTree = registry["filetree"];
  let bodyEl: HTMLElement | undefined = $state();

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
  <!-- Right pane: the tab bar spans the top; below it the file explorer is a sticky addon
       (full height, no frame) docked at the left edge beside the active tab. The tab bar's
       far-left button and ctrl+e both show/hide the explorer. -->
  {@const hidden = explorer?.hidden ?? true}
  <div class="flex h-full min-w-0 flex-col">
    <TabStrip
      {viewId}
      {col}
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
        {#each col.rows as tab (tab.id)}
          {@const Module = registry[tab.kind]}
          <div class="absolute inset-0" class:hidden={tab.id !== col.activeTabId} data-tab-content>
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
      </div>
    </div>
  </div>
{/if}
