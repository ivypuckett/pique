<script lang="ts">
  import { onMount } from "svelte";
  import { fileTreeBindings } from "./bindings.ts";
  import { dirtyDirsFrom, flatten, type Node, nodeFromEntry, parentDir, sortEntries, splitName, updateAt } from "./tree.ts";
  import { openDiff, openEditor } from "../store.ts";
  import { dChordHints, gChordHints, shortcuts } from "./shortcuts.ts";
  import { settings } from "../settings/store.ts";

  let { cwd, viewId }: { title: string; cwd?: string; viewId?: string; tabId?: string } = $props();

  let roots = $state<Node[]>([]);
  let cursor = $state(0);
  let unavailable = $state(false);
  let focused = $state(false);
  let pendingG = $state(false);
  let pendingD = $state(false);
  let showHelp = $state(false);

  // The three edit surfaces. `prompt` is the shared name input behind `a` and `r`
  // (`parent` is where an add lands, `path` is what a rename targets); `pendingDelete`
  // holds the node awaiting confirmation; `error` shows why an edit didn't happen.
  type Prompt = { mode: "add" | "rename"; parent?: string; path?: string; value: string };
  let prompt = $state<Prompt | null>(null);
  let pendingDelete = $state<Node | null>(null);
  let error = $state("");
  let treeEl = $state<HTMLDivElement | null>(null);

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

  // win.bind rejections arrive as an Error or as a bare string depending on where they
  // were thrown; either way show the text rather than "[object Object]".
  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  // Focus (and for a rename, pre-select) whichever edit control just appeared, so the
  // keystroke that opened it flows straight into typing. Focus leaving the tree is also
  // what stops onKey from seeing the keys typed into it.
  function takeFocus(node: HTMLElement) {
    node.focus();
    if (node instanceof HTMLInputElement) node.select();
  }

  // Where a new entry lands: inside the directory under the cursor, otherwise beside the
  // file under the cursor. An empty tree has no cursor, so it falls back to the module's
  // own working directory.
  function addParent(): string | undefined {
    if (rows.length === 0) return cwd;
    const node = rows[cursor].node;
    return node.isDir && !node.isSymlink ? node.path : parentDir(node.path);
  }

  // Re-read the tree after an edit and park the cursor on the entry that changed. A new
  // entry inside a collapsed folder would be invisible, so that folder is opened first.
  async function reveal(path: string, expandParent?: string) {
    const parent = expandParent ? rows.find((r) => r.node.path === expandParent)?.node : undefined;
    if (parent?.isDir && !parent.expanded) await expand(parent);
    await refresh();
    const i = rows.findIndex((r) => r.node.path === path);
    if (i >= 0) cursor = i;
  }

  async function submitPrompt() {
    const p = prompt;
    if (!p || !b) return;
    prompt = null;
    treeEl?.focus();
    try {
      const { path } = p.mode === "add"
        ? await b.createEntry({ parent: p.parent, name: p.value })
        : await b.renameEntry({ path: p.path!, name: p.value });
      await reveal(path, p.mode === "add" ? p.parent : undefined);
    } catch (e) {
      error = message(e);
    }
  }

  function cancelPrompt() {
    prompt = null;
    treeEl?.focus();
  }

  async function removeNode(node: Node) {
    pendingDelete = null;
    treeEl?.focus();
    if (!b) return;
    try {
      await b.removeEntry({ path: node.path });
      await refresh();
    } catch (e) {
      error = message(e);
    }
  }

  async function onKey(ev: KeyboardEvent) {
    // Help toggles independently of tree contents so it works even on an empty tree.
    if (ev.key === "?") {
      showHelp = !showHelp;
      ev.preventDefault();
      return;
    }
    if (ev.key === "Escape" && showHelp) {
      showHelp = false;
      ev.preventDefault();
      return;
    }

    if (unavailable) return;
    const key = ev.key;
    const wasG = pendingG;
    const wasD = pendingD;
    pendingG = false;
    pendingD = false;

    // Add is the one edit that works on an empty tree — with no row under the cursor
    // the new entry lands in the module's own working directory.
    if (key === "a") {
      error = "";
      prompt = { mode: "add", parent: addParent(), value: "" };
      ev.preventDefault();
      return;
    }

    if (rows.length === 0) return;

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

    // dd: delete the item under the cursor. Confirmed first unless the user turned the
    // confirmation off in settings — the delete itself is permanent either way.
    if (key === "d") {
      if (!wasD) pendingD = true;
      else {
        error = "";
        const node = rows[cursor].node;
        if ($settings.workspace.confirmDelete === false) await removeNode(node);
        else pendingDelete = node;
      }
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
      case "r": {
        const node = rows[cursor].node;
        error = "";
        prompt = { mode: "rename", path: node.path, value: node.name };
        break;
      }
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

<div class="relative flex h-full min-w-0 w-full flex-col">
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={treeEl}
  class="min-h-0 w-full flex-1 overflow-auto font-mono text-sm outline-none"
  tabindex="0"
  role="tree"
  aria-label="File tree"
  onkeydown={onKey}
  onfocusin={() => (focused = true)}
  onfocusout={() => {
    focused = false;
    showHelp = false;
  }}
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

  <!-- Footer: shown only while the tree is focused (keys only act on the focused tree, and
       `?` only opens then). Advertises the `?` cheatsheet; swaps to the g-chord follow-ups
       while `g` is armed. Hidden when the overlay is open, since it would sit under it. -->
  {#if focused && !showHelp}
    <div class="flex shrink-0 items-center gap-2 border-t border-base-300 px-2 py-1 text-xs">
      {#if pendingG || pendingD}
        {#each pendingG ? gChordHints : dChordHints as { keys, label } (label)}
          <span class="flex items-center gap-1">
            {#each keys as k}<kbd class="kbd kbd-xs">{k}</kbd>{/each}
            <span class="opacity-60">{label}</span>
          </span>
        {/each}
      {:else}
        <kbd class="kbd kbd-xs">?</kbd>
        <span class="opacity-60">shortcuts</span>
      {/if}
    </div>
  {/if}

  <!-- Why an edit didn't happen (name taken, permissions, a rejected name). Cleared when
       the next edit starts, so it can't outlive the state it describes. -->
  {#if error}
    <div class="shrink-0 border-t border-base-300 px-2 py-1 text-xs text-error">{error}</div>
  {/if}

  <!-- Name input for `a` and `r`. Sits outside the tree container, so what's typed here
       never reaches the tree's own key handling. -->
  {#if prompt}
    <div class="absolute inset-x-2 bottom-2 rounded border border-base-300 bg-base-200 p-2 text-xs shadow-lg">
      <div class="mb-1 opacity-60">
        {prompt.mode === "add" ? "New entry — end with / for a folder" : "Rename"}
      </div>
      <input
        class="input input-bordered input-sm w-full font-mono"
        aria-label={prompt.mode === "add" ? "New entry name" : "New name"}
        bind:value={prompt.value}
        use:takeFocus
        onkeydown={(e) => {
          if (e.key === "Enter") submitPrompt();
          else if (e.key === "Escape") cancelPrompt();
          else return;
          e.preventDefault();
        }}
        onblur={cancelPrompt}
      />
    </div>
  {/if}

  <!-- Delete confirmation. Skipped entirely when workspace.confirmDelete is off. -->
  <div
    class="modal"
    class:modal-open={pendingDelete !== null}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onkeydown={(e) => {
      if (e.key !== "Escape") return;
      pendingDelete = null;
      treeEl?.focus();
      e.preventDefault();
    }}
  >
    <div class="modal-box max-w-sm">
      {#if pendingDelete}
        <div class="text-sm">
          Delete <span class="font-medium">{pendingDelete.name}</span>{pendingDelete.isDir && !pendingDelete.isSymlink ? " and everything inside it?" : "?"}
        </div>
        <div class="mt-1 text-xs opacity-60">This can't be undone.</div>
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => { pendingDelete = null; treeEl?.focus(); }}>
            Cancel
          </button>
          <button type="button" class="btn btn-error btn-sm" use:takeFocus onclick={() => removeNode(pendingDelete!)}>
            Delete
          </button>
        </div>
      {/if}
    </div>
  </div>

  {#if showHelp}
    <div
      class="absolute inset-x-2 bottom-2 rounded border border-base-300 bg-base-200 p-2 text-xs shadow-lg"
    >
      <div class="mb-1 font-semibold uppercase tracking-wide opacity-60">Shortcuts</div>
      {#each shortcuts as { keys, label } (label)}
        <div class="flex items-center justify-between gap-3 py-0.5">
          <span class="flex items-center gap-1">
            <!-- unkeyed: a shortcut's keys can repeat (e.g. "g g"), so key values aren't unique -->
            {#each keys as k}<kbd class="kbd kbd-xs">{k}</kbd>{/each}
          </span>
          <span class="opacity-70">{label}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>
