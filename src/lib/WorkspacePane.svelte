<script lang="ts">
  import { addWorkspace, focusWorkspace, session } from "./store.ts";
  import { ROOT } from "./scope/paths.ts";
  import type { WorkspaceState } from "./workspace.ts";

  // Rail label is the workspace number plus a compact form of its working directory:
  // the last path segment, or "~" when it uses the (home) default. The stored title
  // ("Workspace N"/"Root") is kept for the aria-label and hover tooltip.
  function num(id: string): string {
    return id === ROOT ? "root" : id.replace(/^ws-/, "");
  }
  // A numbered workspace with no cwd of its own inherits root's — the same rule the
  // backend applies when spawning modules (see settings/file.ts resolveModuleDir).
  function fullDir(w: { id: string; cwd?: string }): string {
    const dir = (w.cwd ?? (w.id === ROOT ? "" : $session.root.cwd) ?? "").trim();
    return dir === "" ? "~" : dir;
  }
  function shortDir(w: { id: string; cwd?: string }): string {
    const dir = fullDir(w);
    return dir === "~" ? dir : dir.replace(/\/+$/, "").split("/").pop() || dir;
  }
</script>

<!-- Fixed-width, full-height rail listing the session's workspaces. Shown at one workspace
     too (no auto show/hide on count). ctrl+b toggles it; hiding reflows the main area. -->
<aside class="flex w-45 shrink-0 flex-col gap-1 border-r border-base-300 bg-base-200 p-2">
  <span class="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">
    Workspaces
  </span>
  {#snippet row(w: WorkspaceState)}
    {@const active = w.id === $session.activeId}
    <li>
      <button
        class:menu-active={active}
        class:font-medium={active}
        class:opacity-60={!active}
        aria-label="Switch to {w.title}"
        title="{w.title} — {fullDir(w)}"
        aria-current={active ? "page" : undefined}
        onclick={() => focusWorkspace(w.id)}
      >
        <span class="min-w-0 truncate">{num(w.id)} {shortDir(w)}</span>
      </button>
    </li>
  {/snippet}

  <!-- Root is pinned above the rule; the numbered workspaces below inherit their
       tools, prefs and board from it. The rule is the one visual cue for that
       relationship, so it stays even when there are no workspaces under it yet. -->
  <ul class="menu menu-sm w-full gap-0.5 p-0">
    {@render row($session.root)}
  </ul>

  <!-- base-300 is *darker* than the rail's base-200 on some themes (frappe), so a
       border in it is invisible here. A translucent base-content reads on any theme. -->
  <hr class="mx-1 border-t border-base-content/20" />

  <ul class="menu menu-sm w-full gap-0.5 p-0">
    {#each $session.workspaces as w (w.id)}
      {@render row(w)}
    {/each}
  </ul>
  <button
    class="btn btn-ghost btn-sm mt-auto justify-start font-normal opacity-70"
    aria-label="Add workspace"
    onclick={() => addWorkspace()}
  >+ New workspace</button>
</aside>
