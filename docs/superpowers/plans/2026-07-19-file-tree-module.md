# File Tree Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A vim-navigated file tree in the top-left module that opens a chosen file in `$EDITOR` as a self-closing terminal tab in the center column.

**Architecture:** A new `filetree` frontend module renders a lazily-loaded nested tree from a `listDir` backend binding. Choosing a file calls a store action that adds a center `terminal` tab carrying an `argv` payload; the terminal module is extended to run an arbitrary `argv` (with a `$EDITOR` sentinel resolved backend-side) and to close its own tab when the process exits (`autoCloseOnExit`). Cross-module reach is enabled by threading `viewId`/`tabId` into every module and adding an optional `props` payload to `ModuleRef`.

**Tech Stack:** Deno + `deno desktop` (webview) backend, Svelte 5 (runes), TypeScript, `@sigma/pty-ffi`, `deno test`.

**Spec:** [docs/superpowers/specs/2026-07-19-file-tree-module-design.md](../specs/2026-07-19-file-tree-module-design.md)

**Conventions:**
- Run tests with `deno task test` (which is `deno test -A src/`), or a single file with `deno test -A src/path/to/file_test.ts`.
- Svelte `.svelte` components have no unit-test harness in this repo — only `.ts` files are unit-tested. Component tasks end in a manual-verification note; the final task does the end-to-end check.
- Commit after each task.

---

### Task 1: `ModuleRef.props` payload + `addEditorTab` layout helper

Adds the per-tab payload and the pure function that builds an editor tab. This is the layout-model half of "open a file in the center".

**Files:**
- Modify: `src/lib/layout.ts`
- Test: `src/lib/layout_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/layout_test.ts` (imports at the top of that file already pull from `./layout.ts` — add `addEditorTab` to that import list; if the symbols below aren't imported yet, add them):

```ts
Deno.test("addEditorTab adds an active center terminal tab titled with the basename", () => {
  const v = createInitialView();
  const before = v.center.rows.length;
  const next = addEditorTab(v, "/home/ivy/workspace/pique/src/lib/layout.ts");
  assertEquals(next.center.rows.length, before + 1);
  const tab = next.center.rows[next.center.rows.length - 1];
  assertEquals(tab.kind, "terminal");
  assertEquals(tab.title, "layout.ts");
  assertEquals(next.center.activeTabId, tab.id);
  assertEquals(tab.props, { argv: ["$EDITOR", "/home/ivy/workspace/pique/src/lib/layout.ts"], autoCloseOnExit: true });
});

Deno.test("addEditorTab falls back to the full path when there is no basename", () => {
  const tab = addEditorTab(createInitialView(), "/").center.rows.at(-1)!;
  assertEquals(tab.title, "/");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A src/lib/layout_test.ts`
Expected: FAIL — `addEditorTab` is not exported / not defined.

- [ ] **Step 3: Implement `ModuleRef.props` and `addEditorTab`**

In `src/lib/layout.ts`, extend the `ModuleRef` interface:

```ts
export interface ModuleRef {
  id: string;
  title: string;
  kind: string; // key into the module registry; "placeholder" for now
  props?: { argv?: string[]; autoCloseOnExit?: boolean }; // per-tab payload, spread into the module
}
```

Add these near `addTab` (which already defines `nextCenterId`):

```ts
function basename(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1] : path;
}

// Add a center terminal tab that runs $EDITOR on `path` and closes itself on exit.
export function addEditorTab(v: ViewState, path: string): ViewState {
  const id = nextCenterId(v.center.rows);
  const tab: ModuleRef = {
    id,
    title: basename(path),
    kind: "terminal",
    props: { argv: ["$EDITOR", path], autoCloseOnExit: true },
  };
  return {
    ...v,
    center: { ...v.center, rows: [...v.center.rows, tab], activeTabId: id },
  };
}
```

Note: `isModuleRef` stays unchanged — `props` is optional and not part of the structural guard, so persisted layouts (with or without `props`) still validate.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/layout_test.ts`
Expected: PASS (all layout tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/layout.ts src/lib/layout_test.ts
git commit -m "feat(layout): ModuleRef.props payload + addEditorTab helper"
```

---

### Task 2: `openEditor` store action

Thin store wrapper so a module can open an editor tab in a given view.

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add the action**

In `src/lib/store.ts`, add `addEditorTab as addEditorTabFn` to the existing import block from `./layout.ts`, then add this next to `addTab`:

```ts
// Open `path` in $EDITOR as a self-closing center tab (called by the file-tree module).
export function openEditor(viewId: string, path: string): void {
  edit(viewId, (v) => addEditorTabFn(v, path));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `deno check src/lib/store.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat(store): openEditor action"
```

---

### Task 3: Backend `listDir`

Reads one directory's entries. Pure and unit-testable, no webview.

**Files:**
- Create: `src/lib/fs.ts`
- Test: `src/lib/fs_test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/fs_test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import { listDir } from "./fs.ts";

Deno.test("listDir returns entries with isDir/isSymlink flags", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/sub`);
    await Deno.writeTextFile(`${dir}/file.txt`, "hi");
    await Deno.symlink(`${dir}/file.txt`, `${dir}/link`);

    const entries = await listDir(dir);
    const byName = new Map(entries.map((e) => [e.name, e]));

    assertEquals(byName.get("sub")!.isDir, true);
    assertEquals(byName.get("sub")!.path, `${dir}/sub`);
    assertEquals(byName.get("file.txt")!.isDir, false);
    assertEquals(byName.get("link")!.isSymlink, true);
    assertEquals(byName.get("link")!.isDir, false); // not followed
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("listDir rejects on a missing path", async () => {
  await assertRejects(() => listDir("/no/such/path/here"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/fs_test.ts`
Expected: FAIL — cannot find `./fs.ts`.

- [ ] **Step 3: Implement `listDir`**

Create `src/lib/fs.ts`:

```ts
// Backend directory reader for the file-tree module. Pure Deno fs — no webview.
// Symlinks are reported (isSymlink) but NOT followed: isDir reflects the link itself,
// so a symlink is never expandable and cannot create a traversal loop.

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
}

export async function listDir(path: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const e of Deno.readDir(path)) {
    entries.push({
      name: e.name,
      path: `${path.replace(/\/$/, "")}/${e.name}`,
      isDir: e.isDirectory,
      isSymlink: e.isSymlink,
    });
  }
  return entries;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A src/lib/fs_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fs.ts src/lib/fs_test.ts
git commit -m "feat(fs): backend listDir for the file tree"
```

---

### Task 4: Pure tree model

Sort, flatten (visible rows), and immutable update. This is the whole navigable-state model, testable without a DOM.

**Files:**
- Create: `src/lib/filetree/tree.ts`
- Test: `src/lib/filetree/tree_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/filetree/tree_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { flatten, type Node, nodeFromEntry, sortEntries, updateAt } from "./tree.ts";
import type { Entry } from "../fs.ts";

const e = (name: string, isDir: boolean): Entry => ({
  name,
  path: `/root/${name}`,
  isDir,
  isSymlink: false,
});

Deno.test("sortEntries puts directories first, then case-insensitive alpha", () => {
  const sorted = sortEntries([e("banana.txt", false), e("Zebra", true), e("apple", true), e("Ant.txt", false)]);
  assertEquals(sorted.map((x) => x.name), ["apple", "Zebra", "Ant.txt", "banana.txt"]);
});

Deno.test("nodeFromEntry starts collapsed with no loaded children", () => {
  const n = nodeFromEntry(e("sub", true));
  assertEquals(n.expanded, false);
  assertEquals(n.children, undefined);
});

Deno.test("flatten yields only visible rows with depth", () => {
  const child: Node = { name: "a.txt", path: "/root/dir/a.txt", isDir: false, isSymlink: false, expanded: false };
  const dir: Node = { name: "dir", path: "/root/dir", isDir: true, isSymlink: false, expanded: false, children: [child] };
  const file: Node = { name: "b.txt", path: "/root/b.txt", isDir: false, isSymlink: false, expanded: false };

  const collapsed = flatten([dir, file]);
  assertEquals(collapsed.map((r) => r.node.name), ["dir", "b.txt"]);
  assertEquals(collapsed.map((r) => r.depth), [0, 0]);

  const expanded = flatten([{ ...dir, expanded: true }, file]);
  assertEquals(expanded.map((r) => r.node.name), ["dir", "a.txt", "b.txt"]);
  assertEquals(expanded.map((r) => r.depth), [0, 1, 0]);
});

Deno.test("updateAt replaces the node at a path immutably", () => {
  const dir: Node = { name: "dir", path: "/root/dir", isDir: true, isSymlink: false, expanded: false };
  const roots = [dir];
  const next = updateAt(roots, "/root/dir", (n) => ({ ...n, expanded: true }));
  assertEquals(next[0].expanded, true);
  assertEquals(roots[0].expanded, false); // original untouched
});

Deno.test("updateAt reaches nested children", () => {
  const child: Node = { name: "a", path: "/root/dir/a", isDir: true, isSymlink: false, expanded: false };
  const dir: Node = { name: "dir", path: "/root/dir", isDir: true, isSymlink: false, expanded: true, children: [child] };
  const next = updateAt([dir], "/root/dir/a", (n) => ({ ...n, expanded: true }));
  assertEquals(next[0].children![0].expanded, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A src/lib/filetree/tree_test.ts`
Expected: FAIL — cannot find `./tree.ts`.

- [ ] **Step 3: Implement the tree model**

Create `src/lib/filetree/tree.ts`:

```ts
import type { Entry } from "../fs.ts";

export interface Node {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  expanded: boolean;
  children?: Node[]; // undefined = not yet loaded
}

export interface Row {
  node: Node;
  depth: number;
}

export function nodeFromEntry(e: Entry): Node {
  return { name: e.name, path: e.path, isDir: e.isDir, isSymlink: e.isSymlink, expanded: false };
}

// Directories first, then files; each group case-insensitive alphabetical.
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

// Depth-first list of currently visible rows: a directory's children appear only
// when it is expanded and its children are loaded.
export function flatten(nodes: Node[], depth = 0): Row[] {
  const rows: Row[] = [];
  for (const n of nodes) {
    rows.push({ node: n, depth });
    if (n.isDir && n.expanded && n.children) {
      rows.push(...flatten(n.children, depth + 1));
    }
  }
  return rows;
}

// Return a new tree with the node at `path` replaced by fn(node). Recurses into
// loaded children; nodes off the path are returned unchanged (by reference).
export function updateAt(nodes: Node[], path: string, fn: (n: Node) => Node): Node[] {
  return nodes.map((n) => {
    if (n.path === path) return fn(n);
    if (n.children) return { ...n, children: updateAt(n.children, path, fn) };
    return n;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/filetree/tree_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/filetree/tree.ts src/lib/filetree/tree_test.ts
git commit -m "feat(filetree): pure tree model (sort/flatten/updateAt)"
```

---

### Task 5: `listDir` frontend binding wrapper

Typed access to the `listDir` binding, returning `null` in a browser tab (mirrors `terminalBindings`).

**Files:**
- Create: `src/lib/filetree/bindings.ts`

- [ ] **Step 1: Implement the wrapper**

Create `src/lib/filetree/bindings.ts`:

```ts
// Frontend half of the file-tree binding contract. `globalThis.bindings` is injected
// only inside the desktop window; undefined in a plain browser tab. Keep the arg/return
// shapes in sync by hand with the win.bind("listDir") handler in src/desktop.ts.
import type { Entry } from "../fs.ts";

export interface FileTreeBindings {
  listDir(arg: { path?: string }): Promise<Entry[]>;
}

export function fileTreeBindings(): FileTreeBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as FileTreeBindings) : null;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `deno check src/lib/filetree/bindings.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/filetree/bindings.ts
git commit -m "feat(filetree): typed listDir binding wrapper"
```

---

### Task 6: Register the `listDir` backend binding

Wires `listDir` into the desktop backend, resolving the root the same way terminals resolve their cwd.

**Files:**
- Modify: `src/desktop.ts`

- [ ] **Step 1: Add the binding and load the module**

In `src/desktop.ts`:

1. Add a module handle alongside the existing ones (near line 18):

```ts
let fs: typeof import("./lib/fs.ts");
```

2. Register the binding **before** `Deno.serve` — place it next to the `term*` binds (before the `win.addEventListener("close", ...)` line). Registering before the top-level awaits is mandatory (see the file header):

```ts
win.bind("listDir", async (arg) => {
  const { path } = arg as { path?: string };
  // path undefined → the workspace default; an absolute child path resolves to itself.
  const dir = settings.resolveModuleDir(path, await settings.readJson("settings"));
  return await fs.listDir(dir);
});
```

3. Load the module with the other dynamic imports at the bottom (next to `term = await import(...)`):

```ts
fs = await import("./lib/fs.ts");
```

- [ ] **Step 2: Verify it type-checks**

Run: `deno check src/desktop.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/desktop.ts
git commit -m "feat(desktop): listDir binding for the file tree"
```

---

### Task 7: `argv` support in the PTY session

Lets a terminal session run an arbitrary command (the editor) instead of the interactive shell, resolving the `$EDITOR` sentinel backend-side.

**Files:**
- Modify: `src/lib/terminal/pty.ts`
- Test: `src/lib/terminal/pty_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/terminal/pty_test.ts`:

```ts
Deno.test("startSession with argv runs that command, not the shell", async () => {
  const id = startSession({ cols: 80, rows: 24, argv: ["sh", "-c", "echo argv-ok"] });
  const out = await drain(id, 800);
  killSession(id);
  assertMatch(out, /argv-ok/);
});

Deno.test("startSession resolves the $EDITOR sentinel from the environment", async () => {
  const prev = Deno.env.get("EDITOR");
  Deno.env.set("EDITOR", "sh");
  try {
    const id = startSession({ cols: 80, rows: 24, argv: ["$EDITOR", "-c", "echo editor-ok"] });
    const out = await drain(id, 800);
    killSession(id);
    assertMatch(out, /editor-ok/);
  } finally {
    if (prev === undefined) Deno.env.delete("EDITOR");
    else Deno.env.set("EDITOR", prev);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test -A src/lib/terminal/pty_test.ts`
Expected: FAIL — `startSession` does not accept `argv` (type error) / does not run the command.

- [ ] **Step 3: Implement `argv` handling**

In `src/lib/terminal/pty.ts`, replace the `startSession` signature and body:

```ts
/**
 * Spawn a PTY at the given size and cwd; returns a session id.
 * Default: the user's interactive shell. If `argv` is given, spawn that command
 * instead — an `argv[0]` of "$EDITOR" is resolved to $EDITOR (fallback "vi").
 */
export function startSession(
  opts: { cols: number; rows: number; cwd?: string; argv?: string[] },
): string {
  let cmd: string;
  let args: string[];
  if (opts.argv && opts.argv.length > 0) {
    const [first, ...rest] = opts.argv;
    cmd = first === "$EDITOR" ? (Deno.env.get("EDITOR") ?? "vi") : first;
    args = rest;
  } else {
    cmd = Deno.env.get("SHELL") ?? "bash";
    args = ["-i"];
  }
  const pty = new Pty(cmd, {
    args,
    env: { TERM: "xterm-256color" },
    cwd: opts.cwd,
    size: { rows: opts.rows, cols: opts.cols },
  });
  const id = `t${++counter}`;
  sessions.set(id, { pty });
  return id;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/terminal/pty_test.ts`
Expected: PASS (all pty tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/terminal/pty.ts src/lib/terminal/pty_test.ts
git commit -m "feat(terminal): argv support with \$EDITOR sentinel in startSession"
```

---

### Task 8: Thread `argv` through the terminal binding boundary

Passes `argv` from the frontend `termStart` call through to the backend session.

**Files:**
- Modify: `src/lib/terminal/bindings.ts`
- Modify: `src/desktop.ts`

- [ ] **Step 1: Extend the frontend binding type**

In `src/lib/terminal/bindings.ts`, change the `termStart` signature:

```ts
termStart(arg: { cols: number; rows: number; cwd?: string; argv?: string[] }): Promise<{ id: string }>;
```

- [ ] **Step 2: Pass `argv` through the backend handler**

In `src/desktop.ts`, update the `termStart` bind to read and forward `argv`:

```ts
win.bind("termStart", async (arg) => {
  const { cols, rows, cwd: override, argv } = arg as {
    cols: number;
    rows: number;
    cwd?: string;
    argv?: string[];
  };
  const cwd = settings.resolveModuleDir(override, await settings.readJson("settings"));
  return { id: term.startSession({ cols, rows, cwd, argv }) };
});
```

- [ ] **Step 3: Verify it type-checks**

Run: `deno check src/desktop.ts src/lib/terminal/bindings.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/terminal/bindings.ts src/desktop.ts
git commit -m "feat(terminal): forward argv across the termStart binding"
```

---

### Task 9: Thread `viewId`/`tabId`/`props` into modules

Gives every module its identity (so it can act on its own tab) and spreads the tab payload into it. This is the intrusive seam from the spec.

**Files:**
- Modify: `src/lib/modules/registry.ts`
- Modify: `src/lib/Column.svelte`

- [ ] **Step 1: Widen the registry component type**

In `src/lib/modules/registry.ts`, change the registry type so modules may receive identity + payload props:

```ts
export const registry: Record<
  string,
  Component<{
    title: string;
    cwd?: string;
    viewId?: string;
    tabId?: string;
    argv?: string[];
    autoCloseOnExit?: boolean;
  }>
> = {
  placeholder: Placeholder,
  terminal: Terminal,
  chat: Chat,
};
```

- [ ] **Step 2: Spread identity + props at both render sites**

In `src/lib/Column.svelte`, the center branch renders `<Module title={tab.title} {cwd} />` (~line 50) and the side branch renders `<Module title={row.title} {cwd} />` (~line 91). Update both to pass the view id, the tab/row id, and the payload:

Center branch:

```svelte
<Module title={tab.title} {cwd} {viewId} tabId={tab.id} {...tab.props} />
```

Side branch:

```svelte
<Module title={row.title} {cwd} {viewId} tabId={row.id} {...row.props} />
```

- [ ] **Step 3: Verify it type-checks**

Run: `deno check src/lib/Column.svelte`
Expected: no errors. (Placeholder/Chat ignore the extra props; that is fine — they are optional.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/modules/registry.ts src/lib/Column.svelte
git commit -m "feat(layout): thread viewId/tabId/props into modules"
```

---

### Task 10: Terminal runs `argv` and self-closes on editor exit

The terminal module launches its `argv` and, when launched with `autoCloseOnExit`, removes its own tab when the process ends.

**Files:**
- Modify: `src/lib/terminal/Terminal.svelte`

- [ ] **Step 1: Accept the new props and forward `argv`**

In `src/lib/terminal/Terminal.svelte`, update the props declaration (currently `let { title, cwd } = $props();`) and import `closeTab`:

```svelte
import { closeTab } from "../store.ts";

let { title, cwd, argv, autoCloseOnExit, viewId, tabId }: {
  title: string;
  cwd?: string;
  argv?: string[];
  autoCloseOnExit?: boolean;
  viewId?: string;
  tabId?: string;
} = $props();
```

Change the `termStart` call (currently `await b.termStart({ cols: term.cols, rows: term.rows, cwd })`) to include `argv`:

```svelte
const started = await b.termStart({ cols: term.cols, rows: term.rows, cwd, argv });
```

- [ ] **Step 2: Self-close on exit when configured**

In the read loop, the `done` branch currently writes `[session ended]`. Replace that branch so an editor tab closes itself instead:

```svelte
if (done) {
  if (autoCloseOnExit && viewId && tabId) {
    closeTab(viewId, tabId);
  } else {
    term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
  }
  break;
}
```

Note: `closeTab` refuses to remove the center's last remaining tab (existing guard in `layout.ts`); in that edge case the editor tab stays and shows nothing further, which is acceptable for this milestone.

- [ ] **Step 3: Type-check**

Run: `deno check src/lib/terminal/Terminal.svelte`
Expected: no errors.

- [ ] **Step 4: Manual verification deferred**

Runtime behavior (spawn + auto-close) is exercised in Task 13. Commit now:

```bash
git add src/lib/terminal/Terminal.svelte
git commit -m "feat(terminal): run argv and self-close tab on editor exit"
```

---

### Task 11: The `FileTree.svelte` module

The tree UI, lazy loading, and vim navigation.

**Files:**
- Create: `src/lib/filetree/FileTree.svelte`

- [ ] **Step 1: Implement the component**

Create `src/lib/filetree/FileTree.svelte`:

```svelte
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

  async function refresh() {
    // Re-read every currently-expanded directory, preserving expansion.
    async function rebuild(nodes: Node[]): Promise<Node[]> {
      const out: Node[] = [];
      for (const n of nodes) {
        if (n.isDir && n.expanded) {
          let fresh: Node[] = [];
          try {
            fresh = await load(n.path);
          } catch {
            fresh = [];
          }
          // carry expansion forward for children that are still present
          const prev = new Map((n.children ?? []).map((c) => [c.path, c]));
          const merged = await Promise.all(
            fresh.map(async (c) => {
              const old = prev.get(c.path);
              if (old && old.isDir && old.expanded) {
                return { ...c, expanded: true, children: (await rebuild([old]))[0].children };
              }
              return c;
            }),
          );
          out.push({ ...n, children: merged });
        } else {
          out.push(n);
        }
      }
      return out;
    }
    roots = await rebuild(roots);
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
```

- [ ] **Step 2: Type-check**

Run: `deno check src/lib/filetree/FileTree.svelte`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/filetree/FileTree.svelte
git commit -m "feat(filetree): tree UI with vim navigation"
```

---

### Task 12: Register `filetree` and seed it top-left

Makes the module available and shows it on boot.

**Files:**
- Modify: `src/lib/modules/registry.ts`
- Modify: `src/lib/layout.ts`

- [ ] **Step 1: Register the module**

In `src/lib/modules/registry.ts`, import and register `filetree`:

```ts
import FileTree from "../filetree/FileTree.svelte";
```

```ts
  placeholder: Placeholder,
  terminal: Terminal,
  chat: Chat,
  filetree: FileTree,
```

- [ ] **Step 2: Seed the top-left slot**

In `src/lib/layout.ts`, in `createInitialView`, change the left column's first row kind from `"placeholder"` to `"filetree"` and give it a clearer title:

```ts
      rows: [
        { id: "left-1", title: "Files", kind: "filetree" },
        { id: "left-2", title: "Left B", kind: "placeholder" },
      ],
```

- [ ] **Step 3: Verify existing layout tests still pass**

Run: `deno test -A src/lib/layout_test.ts`
Expected: PASS. (If a test asserts `left-1`'s kind is `"placeholder"`, update that assertion to `"filetree"` — grep `left-1` in the test file.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/modules/registry.ts src/lib/layout.ts
git commit -m "feat(filetree): register module and seed it top-left on boot"
```

---

### Task 13: Full suite + manual end-to-end verification

Confirms the whole loop in the real desktop app.

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `deno task test`
Expected: PASS across `src/` (layout, fs, tree, pty, existing suites).

- [ ] **Step 2: Launch the desktop app**

Run: `deno task dev`
Expected: the app builds and opens.

- [ ] **Step 3: Verify against the spec's success criteria**

Check each:
1. A file tree renders in the top-left slot, rooted at the workspace directory.
2. `j`/`k` move the cursor; `l`/`Enter` on a directory expands it (children load, sorted dirs-first alphabetical); `h` collapses / walks to the parent.
3. `gg`/`G` jump to first/last visible row; `R` refreshes expanded directories.
4. `Enter`/`l` on a file opens a new center tab running `$EDITOR <file>`, titled with the file's basename, and activates it.
5. Quitting the editor (`:q`) auto-closes that center tab and activates a neighbor.
6. A plain shell terminal tab is unaffected: `exit` still shows `[session ended]` and stays open.
7. (Optional) In a browser tab via `deno task web`, the tree shows the "unavailable" state and does not crash.

- [ ] **Step 4: Confirm no leaked processes**

After closing an editor tab and the app, run: `ps aux | grep -E "vi|nvim|nano" | grep -v grep`
Expected: no orphaned editor processes from closed tabs.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(filetree): verification fixes"
```

---

## Self-Review Notes

- **Spec coverage:** filetree module (T4,T11,T12), listDir backend (T3,T6) + frontend binding (T5), vim keys incl. gg/G/R (T11), read-only (no mutation in T11), lazy load (T11 `expand`), dirs-first sort (T4), all-files/no-dotfile-hiding (no filter added), symlinks listed-not-followed (T3 `isDir` from link + T11 skips expand on symlink), new-center-tab-per-file (T1 `addEditorTab` always appends), $EDITOR sentinel backend-resolved (T7), autoCloseOnExit (T10), boot top-left (T12), cross-module seam viewId/tabId/props (T1,T9,T10). All covered.
- **Type consistency:** `Entry` defined in `fs.ts` (T3), reused by `tree.ts` (T4) and `bindings.ts` (T5). `Node`/`Row`/`flatten`/`updateAt`/`sortEntries`/`nodeFromEntry` names match between T4 and T11. `startSession` `argv` (T7) matches the binding forward (T8) and the frontend call (T10). `addEditorTab`/`openEditor` names match T1↔T2↔T11.
- **Placeholder scan:** none — every code step is concrete.
