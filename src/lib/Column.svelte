<script lang="ts">
  import { resizeBoundary, toggleCollapse } from "./store.ts";
  import {
    type ColumnId,
    type ColumnState,
    EXPLORER,
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
  let { viewId, col, right, id, explorerWidthCh, cwd, workspaceId, el = $bindable() }: {
    viewId: string;
    col?: ColumnState;
    right?: RightState;
    id: ColumnId;
    explorerWidthCh?: number;
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
    const def = moduleDef(group);
    return def
      ? `No ${def.label} open — press ${mod}T ${def.key.toUpperCase()}.`
      : "Nothing open.";
  }

  // Inner splitter between the file tree and the files open beside it; the tree is its
  // left column, sized in ch, so the pointer's px are converted through one character's width.
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
       the top lists that row's tabs. The file tree belongs to the explorer row alone,
       where it sits to the left of the files opened from it — every other row has the
       width to itself. -->
  {@const pane = right!}
  {@const shown = pane.activeTabs[pane.activeGroup] ?? ""}
  {@const onExplorer = pane.activeGroup === EXPLORER}
  <!-- With nothing open beside it the tree takes the row, so the splitter and the (empty)
       tab area are out of the grid entirely rather than sharing width with nothing. -->
  {@const withFiles = onExplorer && pane.tabs.some((t) => t.group === EXPLORER)}
  <div class="flex h-full min-w-0">
    <div class="flex min-w-0 flex-1 flex-col">
      <TabStrip {viewId} right={pane} onCollapse={() => toggleCollapse(viewId, "right")} />
      <div
        class="grid min-h-0 min-w-0 flex-1 grid-rows-1"
        style:grid-template-columns={withFiles ? trackPair(explorerWidthCh ?? 30) : "1fr"}
        bind:this={bodyEl}
      >
        <!-- The tree stays mounted while you work in another row — hidden, not unmounted,
             so its expanded folders and cursor are where you left them on the way back. -->
        <div class="min-w-0 overflow-hidden" class:hidden={!onExplorer}>
          <FileTree title="Files" {cwd} {workspaceId} {viewId} tabId="explorer" />
        </div>
        {#if withFiles}
          <Splitter onDrag={onExplorerDrag} />
        {/if}
        <div class="relative min-w-0" class:hidden={onExplorer && !withFiles}>
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
               somewhere else, so it needs something to show. The explorer row never does:
               the tree is its content. -->
          {#if shown === "" && !onExplorer}
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
