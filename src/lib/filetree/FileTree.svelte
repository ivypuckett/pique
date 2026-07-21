<script lang="ts">
  import { onMount } from "svelte";
  import { fileTreeBindings } from "./bindings.ts";
  import { dirtyDirsFrom, flatten, type Node, nodeFromEntry, sortEntries, splitName, updateAt } from "./tree.ts";
  import { openDiff, openEditor } from "../store.ts";

  let { cwd, viewId }: { title: string; cwd?: string; viewId?: string; tabId?: string } = $props();

  let roots = $state<Node[]>([]);
  let cursor = $state(0);
  let unavailable = $state(false);
  let focused = $state(false);
  let pendingG = false;

  // Git change highlighting. `changedFiles` maps each changed file path to its untracked
  // flag (to color the file); `dirtyDirs` holds every folder that contains a change.
  let changedFiles = $state(new Map<string, boolean>());
  let dirtyDirs = $state(new Set<string>());

  async function loadChanges() {
    if (!b?.gitChanges) return;
    try {
      const { changes } = await b.gitChanges({ path: cwd });
      changedFiles = new Map(changes.map((c) => [c.path, c.untracked]));
      dirtyDirs = dirtyDirsFrom(changes.map((c) => c.path));
    } catch {
      changedFiles = new Map();
      dirtyDirs = new Set();
    }
  }

  // A daisyUI text color for a node's git state, or "" for unchanged. Untracked files are
  // green (like VS Code's new files); everything else that's changed — modified/deleted
  // files and folders containing any change — is amber.
  function changeClass(node: Node): string {
    if (node.isDir) return dirtyDirs.has(node.path) ? "text-warning" : "";
    if (!changedFiles.has(node.path)) return "";
    return changedFiles.get(node.path) ? "text-success" : "text-warning";
  }

  const rows = $derived(flatten(roots));
  const b = fileTreeBindings();

  async function load(path?: string): Promise<Node[]> {
    if (!b) throw new Error("no bindings");
    const entries = await b.listDir({ path });
    return sortEntries(entries).map(nodeFromEntry);
  }

  onMount(async () => {
    if (!b) {
      unavailable = true;
      return;
    }
    try {
      roots = await load(cwd);
    } catch {
      roots = [];
    }
    await loadChanges();
  });

  function clampCursor() {
    if (cursor > rows.length - 1) cursor = Math.max(0, rows.length - 1);
    if (cursor < 0) cursor = 0;
  }

  async function expand(node: Node) {
    if (node.children === undefined) {
      let children: Node[] = [];
      try {
        children = await load(node.path);
      } catch {
        children = []; // unreadable dir shows as empty, tree stays usable
      }
      roots = updateAt(roots, node.path, (n) => ({ ...n, children, expanded: true }));
    } else {
      roots = updateAt(roots, node.path, (n) => ({ ...n, expanded: true }));
    }
  }

  function collapse(node: Node) {
    roots = updateAt(roots, node.path, (n) => ({ ...n, expanded: false }));
  }

  // Move the cursor to the nearest row above with a smaller depth (the parent).
  function toParent() {
    const depth = rows[cursor].depth;
    for (let i = cursor - 1; i >= 0; i--) {
      if (rows[i].depth < depth) {
        cursor = i;
        return;
      }
    }
  }

  // Re-list `path` and merge, carrying expansion forward for still-present dirs.
  async function relist(path: string | undefined, existing: Node[]): Promise<Node[]> {
    let fresh: Node[] = [];
    try {
      fresh = await load(path);
    } catch {
      fresh = [];
    }
    const prev = new Map(existing.map((c) => [c.path, c]));
    return await Promise.all(
      fresh.map(async (c) => {
        const old = prev.get(c.path);
        if (old && old.isDir && old.expanded) {
          return { ...c, expanded: true, children: await relist(c.path, old.children ?? []) };
        }
        return c;
      }),
    );
  }

  async function refresh() {
    // Re-read the root listing and every currently-expanded directory below it,
    // preserving expansion. The root itself is always on screen, so it refreshes too.
    roots = await relist(cwd, roots);
    clampCursor();
    await loadChanges();
  }

  async function onKey(ev: KeyboardEvent) {
    if (unavailable || rows.length === 0) return;
    const key = ev.key;
    const wasG = pendingG;
    pendingG = false;

    if (key === "g") {
      if (wasG) cursor = 0;
      else pendingG = true;
      ev.preventDefault();
      return;
    }

    // gd: open the git diff of the item under the cursor. Files diff themselves; a
    // directory diffs every changed file under it (git treats the path as a pathspec).
    if (wasG && key === "d") {
      if (viewId) openDiff(viewId, rows[cursor].node.path);
      ev.preventDefault();
      return;
    }

    switch (key) {
      case "j":
        cursor = Math.min(cursor + 1, rows.length - 1);
        break;
      case "k":
        cursor = Math.max(cursor - 1, 0);
        break;
      case "G":
        cursor = rows.length - 1;
        break;
      case "R":
        await refresh();
        break;
      case "l":
      case "Enter": {
        const node = rows[cursor].node;
        if (node.isDir && !node.isSymlink) {
          if (!node.expanded) await expand(node);
        } else {
          if (viewId) openEditor(viewId, node.path);
        }
        break;
      }
      case "h": {
        const node = rows[cursor].node;
        if (node.isDir && node.expanded) collapse(node);
        else toParent();
        break;
      }
      default:
        return; // let other keys through
    }
    ev.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="h-full min-w-0 w-full overflow-auto font-mono text-sm outline-none"
  tabindex="0"
  role="tree"
  aria-label="File tree"
  onkeydown={onKey}
  onfocusin={() => (focused = true)}
  onfocusout={() => (focused = false)}
>
  {#if unavailable}
    <div class="p-2 opacity-60">File tree unavailable — run the desktop app.</div>
  {:else if rows.length === 0}
    <div class="p-2 opacity-60">Empty</div>
  {:else}
    {#each rows as row, i (row.node.path)}
      {@const parts = splitName(row.node.name)}
      <!-- keyboard nav lives on the tree container (onKey); rows are cursor targets only -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="flex cursor-pointer items-center px-1"
        class:bg-base-300={i === cursor && focused}
        class:bg-base-200={i === cursor && !focused}
        role="treeitem"
        tabindex="-1"
        aria-selected={i === cursor}
        title={row.node.name}
        style:padding-left="{row.depth * 12 + 4}px"
        onclick={() => (cursor = i)}
      >
        <span class="w-4 flex-none">{row.node.isDir ? (row.node.expanded ? "▾" : "▸") : ""}</span>
        <span class="flex min-w-0 flex-1 {changeClass(row.node)}">
          <!-- head sizes to content and shrinks (truncating with …) only when the row
               is too narrow; the extension stays pinned right after it, never a gap. -->
          <span class="min-w-0 truncate">{parts.head}</span>
          {#if parts.tail}<span class="flex-none whitespace-pre">{parts.tail}</span>{/if}
        </span>
        {#if row.node.isSymlink}<span class="flex-none pl-1 opacity-60">↩</span>{/if}
      </div>
    {/each}
  {/if}
</div>
