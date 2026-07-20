<script lang="ts">
  import { addWorkspace, focusWorkspace, session } from "./store.ts";
  import { settings } from "./settings/store.ts";

  // Rail label is the workspace number plus a compact form of its working directory:
  // the last path segment, or "~" when it uses the (home) default. The stored title
  // ("Workspace N") is kept for the aria-label and hover tooltip.
  function num(id: string): string {
    return id.replace(/^ws-/, "");
  }
  function fullDir(cwd: string | undefined): string {
    const dir = (cwd ?? $settings.workspace.defaultDir ?? "").trim();
    return dir === "" ? "~" : dir;
  }
  function shortDir(cwd: string | undefined): string {
    const dir = fullDir(cwd);
    return dir === "~" ? dir : dir.replace(/\/+$/, "").split("/").pop() || dir;
  }
</script>

<!-- Fixed-width, full-height rail listing the session's workspaces. Always visible, even
     at one workspace: a rail that appeared and disappeared would reflow every terminal in
     the app. -->
<aside class="flex w-45 shrink-0 flex-col gap-1 border-r border-base-300 bg-base-200 p-2">
  <span class="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">
    Workspaces
  </span>
  {#each $session.workspaces as w (w.id)}
    {@const active = w.id === $session.activeId}
    <button
      class="btn btn-ghost btn-sm justify-start gap-2"
      class:btn-active={active}
      class:text-primary={active}
      class:font-medium={active}
      class:font-normal={!active}
      class:opacity-60={!active}
      aria-label="Switch to {w.title}"
      title="{w.title} — {fullDir(w.cwd)}"
      aria-pressed={active}
      onclick={() => focusWorkspace(w.id)}
    >
      <span class="h-4 w-0.5 shrink-0 rounded-full {active ? 'bg-primary' : 'bg-transparent'}"></span>
      <span class="min-w-0 truncate">{num(w.id)} {shortDir(w.cwd)}</span>
    </button>
  {/each}
  <button
    class="btn btn-ghost btn-sm mt-auto justify-start font-normal opacity-70"
    aria-label="Add workspace"
    onclick={() => addWorkspace()}
  >+ New workspace</button>
</aside>
