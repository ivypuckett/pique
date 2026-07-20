<script lang="ts">
  import { onMount } from "svelte";
  import { fileTreeBindings } from "./bindings.ts";
  import { flatten, type Node, nodeFromEntry, sortEntries, updateAt } from "./tree.ts";
  import { openEditor } from "../store.ts";

  let { cwd, viewId }: { title: string; cwd?: string; viewId?: string; tabId?: string } = $props();

  let roots = $state<Node[]>([]);
  let cursor = $state(0);
  let unavailable = $state(false);
  let pendingG = false;

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
  class="h-full w-full overflow-auto font-mono text-sm outline-none"
  tabindex="0"
  role="tree"
  aria-label="File tree"
  onkeydown={onKey}
>
  {#if unavailable}
    <div class="p-2 opacity-60">File tree unavailable — run the desktop app.</div>
  {:else if rows.length === 0}
    <div class="p-2 opacity-60">Empty</div>
  {:else}
    {#each rows as row, i (row.node.path)}
      <div
        class="cursor-pointer truncate whitespace-pre px-1"
        class:bg-base-300={i === cursor}
        role="treeitem"
        aria-selected={i === cursor}
        onclick={() => (cursor = i)}
      >{"  ".repeat(row.depth)}{row.node.isDir ? (row.node.expanded ? "▾ " : "▸ ") : "  "}{row.node.name}{row.node.isSymlink ? " ↩" : ""}</div>
    {/each}
  {/if}
</div>
