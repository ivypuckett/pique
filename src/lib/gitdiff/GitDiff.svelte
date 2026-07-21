<script lang="ts">
  import { onMount } from "svelte";
  import { DiffModeEnum, DiffView } from "@git-diff-view/svelte";
  import "@git-diff-view/svelte/styles/diff-view.css";
  import { gitDiffBindings } from "./bindings.ts";
  import { type FileDiff, splitDiff } from "./diff.ts";
  import { diffThemeFromDaisyui } from "./theme.ts";

  // `path` scopes the diff to one file (file-tree gd chord); unset = whole working tree.
  let { cwd, path }: { title: string; cwd?: string; viewId?: string; tabId?: string; path?: string } =
    $props();

  let files = $state<FileDiff[]>([]);
  let staged = $state(false);
  let mode = $state<DiffModeEnum>(DiffModeEnum.Split);
  let unavailable = $state(false);
  let error = $state<string | null>(null);
  // git-diff-view supports "light" | "dark"; derived from the active daisyui theme and
  // kept in sync as it changes at runtime (see the observer in onMount).
  let theme = $state<"light" | "dark">("dark");
  let root: HTMLDivElement;

  const b = gitDiffBindings();

  async function load() {
    if (!b) {
      unavailable = true;
      return;
    }
    error = null;
    try {
      const { diff } = await b.gitDiff({ cwd, staged, path });
      files = splitDiff(diff);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      files = [];
    }
  }

  function dataFor(f: FileDiff) {
    return {
      oldFile: { fileName: f.oldName, fileLang: f.lang || null },
      newFile: { fileName: f.newName, fileLang: f.lang || null },
      hunks: [f.hunk],
    };
  }

  function label(f: FileDiff): string {
    if (f.oldName === "/dev/null") return f.newName;
    if (f.newName === "/dev/null") return f.oldName;
    if (f.oldName !== f.newName) return `${f.oldName} → ${f.newName}`;
    return f.newName;
  }

  onMount(() => {
    load();
    // Track the daisyui theme so an already-open diff re-themes when the user switches
    // themes in settings (mirrors the terminal module's theme observer).
    theme = diffThemeFromDaisyui(root);
    const observer = new MutationObserver(() => (theme = diffThemeFromDaisyui(root)));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  });
</script>

<div class="gitdiff-root flex h-full min-w-0 flex-col" bind:this={root}>
  <div class="flex shrink-0 items-center gap-2 border-b border-base-300 bg-base-200 px-2 py-1 text-sm">
    <div class="join">
      <button
        class="btn join-item btn-xs"
        class:btn-active={!staged}
        onclick={() => {
          staged = false;
          load();
        }}>Working tree</button>
      <button
        class="btn join-item btn-xs"
        class:btn-active={staged}
        onclick={() => {
          staged = true;
          load();
        }}>Staged</button>
    </div>
    <div class="join">
      <button
        class="btn join-item btn-xs"
        class:btn-active={mode === DiffModeEnum.Split}
        onclick={() => (mode = DiffModeEnum.Split)}>Split</button>
      <button
        class="btn join-item btn-xs"
        class:btn-active={mode === DiffModeEnum.Unified}
        onclick={() => (mode = DiffModeEnum.Unified)}>Unified</button>
    </div>
    <button class="btn btn-ghost btn-xs" onclick={load} aria-label="Refresh">↻</button>
  </div>

  <div class="min-h-0 flex-1 overflow-auto">
    {#if unavailable}
      <div class="p-2 opacity-60">Git diff unavailable — run the desktop app.</div>
    {:else if error}
      <div class="p-2 font-mono text-sm text-error whitespace-pre-wrap">{error}</div>
    {:else if files.length === 0}
      <div class="p-2 opacity-60">No {staged ? "staged " : ""}changes.</div>
    {:else}
      {#each files as f (f.oldName + "\0" + f.newName)}
        <div class="border-b border-base-300">
          <div class="bg-base-200 px-2 py-1 font-mono text-xs opacity-80">{label(f)}</div>
          <DiffView
            data={dataFor(f)}
            diffViewMode={mode}
            diffViewTheme={theme}
            diffViewHighlight={true}
            diffViewFontSize={13}
          />
        </div>
      {/each}
    {/if}
  </div>
</div>

<!--
  Repaint git-diff-view's internal palette from pique's daisyui theme so the diff chrome
  matches the active theme exactly (not just light/dark), following any theme — including
  future ones — with no JS. add/del keep green/red semantics as a subtle tint of the
  theme's success/error over the base. `diffViewTheme` still drives the syntax-highlight
  text colors, which is why it stays synced to light/dark above.

  Why the `--pq-*` indirection: git-diff-view puts `data-theme` on its own wrapper, and
  daisyui treats ANY [data-theme] as a theme scope — so inside the diff `var(--color-*)`
  would resolve to daisyui's generic light/dark theme, not pique's. We snapshot pique's
  real colors into `--pq-*` on our root (outside that scope); custom-property inheritance
  carries the computed values down into the diff untouched, and they still track theme
  changes live because the snapshot itself is `var(--color-*)`.
  Coupling note: the `.diff-style-root` class and `--diff-*` names are git-diff-view v0.1
  internals; git-diff-view's stylesheet sets them on `.diff-style-root`, so we must too.
-->
<style>
  .gitdiff-root {
    --pq-base-100: var(--color-base-100);
    --pq-base-200: var(--color-base-200);
    --pq-base-300: var(--color-base-300);
    --pq-base-content: var(--color-base-content);
    --pq-success: var(--color-success);
    --pq-error: var(--color-error);
  }

  :global(.diff-tailwindcss-wrapper .diff-style-root) {
    --diff-border--: var(--pq-base-300) !important;

    --diff-plain-content--: var(--pq-base-100) !important;
    --diff-expand-content--: var(--pq-base-100) !important;
    --diff-empty-content--: var(--pq-base-200) !important;

    --diff-plain-lineNumber--: var(--pq-base-200) !important;
    --diff-plain-lineNumber-color--: color-mix(in oklch, var(--pq-base-content) 55%, var(--pq-base-100)) !important;
    --diff-expand-lineNumber--: var(--pq-base-200) !important;
    --diff-expand-lineNumber-color--: color-mix(in oklch, var(--pq-base-content) 55%, var(--pq-base-100)) !important;

    --diff-hunk-content--: var(--pq-base-200) !important;
    --diff-hunk-content-color--: color-mix(in oklch, var(--pq-base-content) 65%, var(--pq-base-100)) !important;
    --diff-hunk-lineNumber--: var(--pq-base-200) !important;
    --diff-hunk-lineNumber-hover--: var(--pq-base-300) !important;

    --diff-add-content--: color-mix(in oklch, var(--pq-success) 16%, var(--pq-base-100)) !important;
    --diff-add-content-highlight--: color-mix(in oklch, var(--pq-success) 30%, var(--pq-base-100)) !important;
    --diff-add-lineNumber--: color-mix(in oklch, var(--pq-success) 22%, var(--pq-base-100)) !important;
    --diff-add-widget--: color-mix(in oklch, var(--pq-success) 24%, var(--pq-base-100)) !important;
    --diff-add-widget-color--: var(--pq-base-content) !important;

    --diff-del-content--: color-mix(in oklch, var(--pq-error) 16%, var(--pq-base-100)) !important;
    --diff-del-content-highlight--: color-mix(in oklch, var(--pq-error) 30%, var(--pq-base-100)) !important;
    --diff-del-lineNumber--: color-mix(in oklch, var(--pq-error) 22%, var(--pq-base-100)) !important;
  }
</style>
