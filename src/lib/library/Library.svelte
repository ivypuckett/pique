<script lang="ts">
  import { ROOT } from "../scope/paths.ts";
  import Extensions from "../extensions/Extensions.svelte";
  import Prompts from "../prompts/Prompts.svelte";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  // Which scope this module acts on: its own workspace's, or the shared root one it
  // inherits from. Root itself has nothing else to switch to, so the toggle is hidden
  // there — same shape as Kanban's board switcher.
  //
  // `workspaceId` is optional only because Column threads it through as optional; every
  // real workspace has an id, and root's IS `ROOT` (session.ts). Normalizing here keeps
  // `scope` a plain string for the sections.
  const workspace = $derived(workspaceId ?? ROOT);
  const isRootWorkspace = $derived(workspace === ROOT);
  let showRoot = $state(false);
  const scope = $derived(showRoot ? ROOT : workspace);
  // NOT the same as isRootWorkspace: a workspace viewing root's list is editing root.
  // The sections use this to say whether a change reaches every workspace.
  const scopeIsRoot = $derived(scope === ROOT);

  let section = $state<"extensions" | "prompts">("extensions");

  // A module tab stays mounted when it is not the active one (Column.svelte hides it
  // with a class), so there is no re-open to re-list on the way the modal had. Bumping
  // this counter is how the shell asks the sections to re-read; they also re-read when
  // the scope changes.
  let refreshKey = $state(0);
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-3 py-1.5">
    <div class="flex gap-1" role="group" aria-label="Section">
      <button
        class="btn btn-ghost btn-xs"
        class:btn-active={section === "extensions"}
        aria-pressed={section === "extensions"}
        onclick={() => (section = "extensions")}
      >Extensions</button>
      <button
        class="btn btn-ghost btn-xs"
        class:btn-active={section === "prompts"}
        aria-pressed={section === "prompts"}
        onclick={() => (section = "prompts")}
      >Prompts</button>
    </div>

    {#if !isRootWorkspace}
      <div class="ml-3 flex items-center gap-1" role="group" aria-label="Scope">
        <span class="mr-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">Scope</span>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={!showRoot}
          aria-pressed={!showRoot}
          onclick={() => (showRoot = false)}
        >Workspace</button>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={showRoot}
          aria-pressed={showRoot}
          onclick={() => (showRoot = true)}
        >Root</button>
        <span class="ml-2 text-xs opacity-60">
          {showRoot ? "Shared with every workspace." : "This workspace only; adds to what it inherits from root."}
        </span>
      </div>
    {/if}

    <button
      class="btn btn-ghost btn-xs ml-auto"
      aria-label="Refresh"
      title="Re-read this scope's extensions and templates"
      onclick={() => refreshKey++}
    >↻</button>
  </div>

  <!-- Both sections stay mounted and the inactive one is hidden, the way Column.svelte
       hides inactive module tabs. Tearing one down on every sub-tab switch would discard
       an in-progress prompt draft — the modal never had that problem, because both
       sections lived in one long-lived script. -->
  <div class="min-h-0 flex-1 overflow-y-auto p-4" class:hidden={section !== "extensions"}>
    <Extensions {scope} inRoot={scopeIsRoot} {refreshKey} />
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto p-4" class:hidden={section !== "prompts"}>
    <Prompts {scope} inRoot={scopeIsRoot} {refreshKey} />
  </div>
</div>
