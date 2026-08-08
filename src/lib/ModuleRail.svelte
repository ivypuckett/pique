<script lang="ts">
  import { selectGroup } from "./store.ts";
  import { moduleLabel, type RightState } from "./layout.ts";
  import { isDuplicable, railGroups } from "./modules/manifest.ts";

  let { viewId, right }: { viewId: string; right: RightState } = $props();

  const groups = railGroups();

  // How many tabs a row is holding. Shown only where it can be more than one, so a
  // singleton row never carries a "1" that means nothing.
  function count(group: string): number {
    return right.tabs.filter((t) => t.group === group).length;
  }
</script>

<!-- The workspace rail mirrored: fixed width, full height of the pane, bordered on the
     side it docks to. This one lists the view's modules instead of the session's
     workspaces, and one row is selected the way one workspace is. ctrl+shift+b hides it
     the way ctrl+b hides that one — the list goes, the selected module stays on screen,
     named by the tab bar above it. -->
<aside class="flex w-32 shrink-0 flex-col gap-1 border-l border-base-300 bg-base-200 p-2">
  <span class="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">
    Modules
  </span>
  <ul class="menu menu-sm w-full gap-0.5 p-0">
    {#each groups as group (group)}
      {@const active = group === right.activeGroup}
      {@const open = count(group)}
      <li>
        <button
          class:menu-active={active}
          class:font-medium={active}
          class:opacity-60={!active}
          aria-label="Show {moduleLabel(group)}"
          aria-current={active ? "page" : undefined}
          onclick={() => selectGroup(viewId, group)}
        >
          <span class="min-w-0 truncate">{moduleLabel(group)}</span>
          {#if isDuplicable(group) && open > 1}
            <span class="badge badge-ghost badge-xs">{open}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</aside>
