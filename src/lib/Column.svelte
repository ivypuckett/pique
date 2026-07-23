<script lang="ts">
  import { toggleCollapse } from "./store.ts";
  import { type ColumnId, type ColumnState, type SideId } from "./layout.ts";
  import ModuleFrame from "./ModuleFrame.svelte";
  import TabStrip from "./TabStrip.svelte";
  import { registry } from "./modules/registry.ts";

  let { viewId, col, id, cwd, workspaceId, el = $bindable() }: {
    viewId: string;
    col: ColumnState;
    id: ColumnId;
    cwd?: string;
    workspaceId?: string;
    el?: HTMLElement;
  } = $props();

  const sideId = $derived(id as SideId);
</script>

{#if col.collapsed}
  <div
    class="flex flex-col items-center gap-1 bg-base-200 pt-2"
    bind:this={el}
  >
    <button
      class="btn btn-ghost btn-xs"
      aria-label="Expand {id} column"
      onclick={() => toggleCollapse(viewId, sideId)}
    >»</button>
    <span class="mt-1 [writing-mode:vertical-rl] text-xs opacity-60">{col.rows[0].title}</span>
  </div>
{:else if id === "center"}
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
{:else if id === "right"}
  <!-- Right holds the configurable tabs. -->
  <div class="flex h-full min-w-0 flex-col" bind:this={el}>
    <TabStrip {viewId} {col} onCollapse={() => toggleCollapse(viewId, "right")} />
    <div class="relative min-h-0 flex-1">
      {#each col.rows as tab (tab.id)}
        {@const Module = registry[tab.kind]}
        <div class="absolute inset-0" class:hidden={tab.id !== col.activeTabId}>
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
{:else}
  <!-- Left column: a single module with a collapse control. -->
  {@const row = col.rows[0]}
  {@const Module = registry[row.kind]}
  <div class="flex h-full min-w-0 flex-col" bind:this={el}>
    <div class="min-h-0 min-w-0 flex-1">
      <ModuleFrame title={row.title}>
        {#snippet actions()}
          <button
            class="btn btn-ghost btn-xs"
            aria-label="Collapse {id} column"
            onclick={() => toggleCollapse(viewId, sideId)}
          >«</button>
        {/snippet}
        {#if Module}
          <Module title={row.title} {cwd} {workspaceId} {viewId} tabId={row.id} {...row.props} />
        {:else}
          <div class="text-sm opacity-60">
            Unknown module: <span class="font-mono">{row.kind}</span>
          </div>
        {/if}
      </ModuleFrame>
    </div>
  </div>
{/if}
