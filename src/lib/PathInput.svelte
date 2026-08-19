<script lang="ts">
  import type { Entry } from "./fs.ts";
  import { listEntries } from "./settings/bindings.ts";
  import { drill, normalize, splitPath, suggest } from "./pathpicker.ts";

  // The working-directory picker: a path text box whose dropdown offers the next level
  // of subfolders. It replaced a native folder dialog (kdialog/zenity), which only
  // existed on Linux and could not be reached from the desktop's webview at all.
  //
  // The box holds the path as a raw string, `~` and all, so going UP is ordinary text
  // editing — there is no parent entry in the dropdown, and no directory it refuses to
  // leave. `path` is the committed value and the box mirrors it whenever it isn't being
  // edited; blank means the workspace inherits its directory, shown as the "~" the
  // backend resolves that to.
  //
  // The box is right-aligned: a path longer than its 32ch then keeps its tail — the
  // meaningful end — in view rather than its root, and drilling deeper doesn't push
  // what you just picked out of sight.
  let { path, onCommit }: { path: string; onCommit: (path: string) => void } =
    $props();

  let el = $state<HTMLInputElement | null>(null);
  let focused = $state(false);
  let text = $state("");
  let entries = $state<Entry[]>([]);
  let highlight = $state(-1); // -1 = none, so Enter commits rather than drilling in
  let bad = $state(false); // the directory in the box doesn't list
  let listEl = $state<HTMLUListElement | null>(null);

  const split = $derived(splitPath(text));
  const options = $derived(split ? suggest(entries, split.frag) : []);
  const open = $derived(focused && options.length > 0);

  // One listing per directory crossed rather than per keystroke: the parent changes only
  // when a "/" is typed or a suggestion is taken, and the fragment filters what's already
  // here. Plain `let`, not $state, so the effect doesn't retrigger on its own write; it
  // also drops a slow response the user has already typed past.
  let listed: string | null = null;
  $effect(() => {
    const parent = split?.parent ?? null;
    if (parent === null) {
      listed = null;
      entries = [];
      return;
    }
    if (parent === listed) return;
    listed = parent;
    listEntries(parent).then((res) => {
      if (listed !== parent) return;
      entries = res ?? [];
      bad = res === null;
    });
  });

  // A path wider than the box renders from its start, which is its least informative
  // end, so the resting box is parked at its far end instead — the same tail the
  // fixed-width button this replaced kept behind a leading "…". A path that fits is
  // untouched, and stays left-aligned like any other text. Alignment can't do this job:
  // an overflowing input fills its box, so text-align has nothing left to place. While
  // focused the caret keeps the end in view on its own.
  $effect(() => {
    path;
    if (!focused && el) el.scrollLeft = el.scrollWidth;
  });

  // Keep the highlighted row on screen — the list scrolls past its max height.
  $effect(() => {
    if (highlight < 0) return;
    listEl?.children[highlight]?.scrollIntoView({ block: "nearest" });
  });

  function take(i: number): void {
    if (!split) return;
    text = drill(split.parent, options[i].name);
    highlight = -1;
    bad = false;
    el?.focus();
  }

  // Enter with nothing highlighted. A path that doesn't list is refused and keeps focus,
  // so a typo can be corrected in place; an empty box commits, restoring inheritance.
  async function commit(): Promise<void> {
    const dir = normalize(text);
    if (dir !== "" && (await listEntries(dir)) === null) {
      bad = true;
      return;
    }
    onCommit(dir);
    el?.blur();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      const next = highlight + (e.key === "ArrowDown" ? 1 : -1);
      highlight = Math.max(-1, Math.min(next, options.length - 1));
      return;
    }
    // Tab completes the way a shell does: it takes the highlighted suggestion, or the
    // first one when you haven't moved off the box. Completing is drilling in, never
    // committing. With nothing on offer — and on shift+tab — it moves focus as usual.
    if (e.key === "Tab" && open && !e.shiftKey) {
      e.preventDefault();
      take(Math.max(highlight, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0) take(highlight);
      else void commit();
      return;
    }
    if (e.key === "Escape") {
      // Abandon the edit outright, dropdown and all: blurring is what reverts the box
      // to the committed path, since an unfocused box mirrors it.
      e.preventDefault();
      el?.blur();
    }
  }
</script>

<div class="relative">
  <input
    bind:this={el}
    type="text"
    class="input input-bordered input-xs w-[32ch] shrink-0 font-mono text-xs"
    class:input-error={bad}
    aria-label="Working directory for new modules in this workspace"
    role="combobox"
    aria-expanded={open}
    aria-controls="path-input-options"
    aria-autocomplete="list"
    autocomplete="off"
    spellcheck="false"
    title={path || "~"}
    value={focused ? text : path || "~"}
    oninput={(e) => {
      text = e.currentTarget.value;
      highlight = -1;
      bad = false;
    }}
    onfocus={() => {
      text = path || "~";
      focused = true;
      highlight = -1;
      bad = false;
      // Typing continues at the end of the path, which is not where focus() alone leaves
      // the caret — ctrl+j o would otherwise build "/~". A click sets its own caret after
      // this, so pointing at a spot mid-path still lands there. The rendered value is
      // already `text` (an unfocused box mirrors `path`), so there is nothing to await.
      el?.setSelectionRange(text.length, text.length);
    }}
    onblur={() => (focused = false)}
    onkeydown={onKeydown}
  />
  {#if open}
    <!-- mousedown is swallowed on the options so clicking one never blurs the box,
         which would revert the edit before the click lands. -->
    <ul
      bind:this={listEl}
      id="path-input-options"
      role="listbox"
      class="menu menu-xs absolute z-20 mt-1 max-h-64 w-[32ch] flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
      onmousedown={(e) => e.preventDefault()}
    >
      {#each options as o, i (o.path)}
        <li role="none">
          <button
            type="button"
            role="option"
            aria-selected={i === highlight}
            class="block w-full truncate text-left font-mono text-xs"
            class:menu-active={i === highlight}
            onclick={() => take(i)}
          >{o.name}/</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
