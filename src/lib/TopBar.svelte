<script lang="ts">
  import {
    activeWorkspace,
    focusView,
    moduleRailHidden,
    resetView,
    session,
    setWorkspaceDir,
    workspaceRailHidden,
  } from "./store.ts";
  import { settingsOpen } from "./settings/store.ts";
  import PathInput from "./PathInput.svelte";
  import { ROOT } from "./scope/paths.ts";

  // This workspace's own override, falling back to root's (root has nothing to fall
  // back to); blank shows a "~" hint, since the backend resolves the default to the
  // home directory. It is also where the picker starts, so editing a workspace's
  // directory begins at the one it is already using.
  const dir = $derived(
    $activeWorkspace.cwd ?? ($activeWorkspace.id === ROOT ? "" : $session.root.cwd) ?? "",
  );
</script>

<header class="flex h-9 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
  <div class="flex min-w-0 items-center gap-3">
    <PathInput path={dir} onCommit={setWorkspaceDir} />
    <div class="flex items-center gap-1">
      <span class="text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">View</span>
      <ul class="menu menu-horizontal menu-xs gap-1 p-0">
        {#each $activeWorkspace.views as v, i (v.id)}
          {@const active = v.id === $activeWorkspace.activeId}
          <li>
            <button
              class="px-2"
              class:menu-active={active}
              class:font-medium={active}
              class:opacity-60={!active}
              aria-label="Switch to view {i + 1}"
              aria-current={active ? "page" : undefined}
              onclick={() => focusView(v.id)}
            >{i + 1}</button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
  <div class="flex items-center gap-1">
    <button
      class="btn btn-ghost btn-sm"
      class:btn-active={!$workspaceRailHidden}
      aria-label="Toggle workspaces"
      aria-pressed={!$workspaceRailHidden}
      onclick={() => workspaceRailHidden.update((h) => !h)}
    >◧</button>
    <button
      class="btn btn-ghost btn-sm"
      class:btn-active={!$moduleRailHidden}
      aria-label="Toggle modules"
      aria-pressed={!$moduleRailHidden}
      onclick={() => moduleRailHidden.update((h) => !h)}
    >◨</button>
    <button
      class="btn btn-ghost btn-sm"
      onclick={() => {
        resetView($activeWorkspace.activeId);
        // Reset restores every panel, including the two rails
        workspaceRailHidden.set(false);
        moduleRailHidden.set(false);
      }}
    >Reset</button>
    <button
      class="btn btn-ghost btn-sm"
      aria-label="Open settings"
      onclick={() => settingsOpen.set(true)}
    >⚙</button>
  </div>
</header>
