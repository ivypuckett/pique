<script lang="ts">
  import {
    activeView,
    activeWorkspace,
    focusView,
    resetView,
    setWorkspaceDir,
    toggleCollapse,
    workspaceRailHidden,
  } from "./store.ts";
  import { settings, settingsOpen } from "./settings/store.ts";
  import { pickDirectory } from "./settings/bindings.ts";

  // The workspace override, falling back to the global default; blank shows a "~"
  // hint (the default resolves to the home directory backend-side).
  const dir = $derived($activeWorkspace.cwd ?? $settings.workspace.defaultDir ?? "");

  // The button is a fixed 32ch monospace box; ~28 chars fit inside its padding.
  // A path longer than that keeps its tail (the meaningful end) behind a leading
  // "…"; CSS ellipsis can't do this on the left without reordering absolute paths.
  const MAX = 28;
  const shown = $derived.by(() => {
    const s = dir || "~";
    return s.length > MAX ? "…" + s.slice(-(MAX - 1)) : s;
  });

  async function pickDir(): Promise<void> {
    const picked = await pickDirectory(dir);
    if (picked) setWorkspaceDir(picked);
  }
</script>

<header class="flex h-9 shrink-0 items-center justify-between border-b border-base-300 bg-base-200 px-3">
  <div class="flex min-w-0 items-center gap-3">
    <button
      class="input input-bordered input-xs w-[32ch] shrink-0 overflow-hidden whitespace-nowrap text-left font-mono text-xs"
      aria-label="Working directory for new modules in this workspace"
      title={dir || "~"}
      onclick={pickDir}
    >{shown}</button>
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
      class:btn-active={!$activeView.right.collapsed}
      aria-label="Toggle right pane"
      aria-pressed={!$activeView.right.collapsed}
      onclick={() => toggleCollapse($activeWorkspace.activeId, "right")}
    >◨</button>
    <button
      class="btn btn-ghost btn-sm"
      onclick={() => {
        resetView($activeWorkspace.activeId);
        workspaceRailHidden.set(false); // reset restores every panel, including the rail
      }}
    >Reset</button>
    <button
      class="btn btn-ghost btn-sm"
      aria-label="Open settings"
      onclick={() => settingsOpen.set(true)}
    >⚙</button>
  </div>
</header>
