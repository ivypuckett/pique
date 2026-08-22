<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { CommandInfo, ThinkingLevel } from "./bindings.ts";
  import { chatSession } from "./store.ts";

  let { title, cwd, workspaceId, viewId }: { title: string; cwd?: string; workspaceId?: string; viewId?: string } =
    $props();

  // The conversation lives in a session of this view's own, so each view of a workspace
  // has its own transcript, input and streaming state. This component is a thin view
  // over it. workspaceId and viewId are fixed for this instance (the tree is keyed by
  // both) and cwd only seeds a new session, so we deliberately read all three once at
  // creation — untrack tells Svelte that's intended.
  const session = untrack(() => chatSession(workspaceId, viewId, cwd));
  const { items, input, ready, streaming, models, level } = session;
  const commands = session.commands;

  const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];

  // A new chat leaves the current conversation behind, so it is held here until
  // confirmed. Held here rather than in the store: until it is confirmed, nothing about
  // the conversation has changed.
  let pending = $state<{ kind: "new" } | null>(null);

  function confirmPending() {
    pending = null;
    session.newChat();
  }

  // `/` command menu (skills / prompt templates / extension commands). Loaded once
  // the agent is ready; session.prompt() expands/runs them, so this is pure compose UI.
  let menuIndex = $state(0);
  let dismissed = $state(false);
  let inputEl = $state<HTMLTextAreaElement>();
  // The token after `/`, or undefined once a space is typed (which closes the menu).
  const query = $derived(/^\/(\S*)$/.exec($input)?.[1]);
  const menu = $derived.by(() => {
    if (query === undefined || dismissed) return [];
    const q = query.toLowerCase();
    return $commands.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
  });
  // Reset the highlight whenever the filtered list changes (but not on plain arrowing).
  $effect(() => { menu; menuIndex = 0; });

  function selectCommand(c: CommandInfo) {
    input.set(`/${c.name} `);
    inputEl?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (menu.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); menuIndex = (menuIndex + 1) % menu.length; }
      else if (e.key === "ArrowUp") { e.preventDefault(); menuIndex = (menuIndex - 1 + menu.length) % menu.length; }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectCommand(menu[menuIndex]); }
      else if (e.key === "Escape") { e.preventDefault(); dismissed = true; }
      return;
    }
    // A textarea has no implicit submit, so Enter is sent by hand — and Shift+Enter is
    // now the way to type the newline the box can finally show. isComposing guards an
    // IME: mid-composition Enter picks a candidate, and must not send the message.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if ($ready && !$streaming) session.send();
    }
  }

  // Grow the box to fit what is in it rather than scrolling a one-line slot. Height is
  // cleared before it is read: scrollHeight only ever reports the content's full height
  // when the element is not already sized to something taller. The border is added back
  // because the height set here is a border-box one while scrollHeight is not, and being
  // short by that much is exactly enough to raise a scrollbar on a single line.
  //
  // An $effect keyed on $input so it also follows text the app puts there (a picked `/`
  // command, a cleared box after send), not only typing. max-h in the markup is what
  // stops a pasted file from pushing the transcript off screen — past it, it scrolls.
  $effect(() => {
    const el = inputEl;
    if (!el) return;
    void $input;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  });

  // Terminal-style transcript: new output pushes older lines up rather than landing
  // below the fold. The pane stays pinned to the bottom until the reader scrolls away
  // from it, and re-pins as soon as they scroll back down.
  let scroller = $state<HTMLDivElement>();
  let content = $state<HTMLDivElement>();
  let pinned = true;
  let lastTop = 0;

  function onScroll() {
    // A background tab is display:none rather than unmounted, and reports every metric
    // as 0 — which reads as "at the bottom". Ignore it, so switching tabs cannot
    // silently re-pin a reader who had scrolled up.
    if (scroller!.clientHeight === 0) return;
    const top = scroller!.scrollTop;
    // Landing at the bottom always pins — including after the transcript is cleared, or
    // shrinks under us. The tolerance survives subpixel rounding at the true bottom and
    // lets a flick that stops just short of it count as coming back.
    if (scroller!.scrollHeight - top - scroller!.clientHeight < 24) pinned = true;
    // Unpinning cannot ask "am I at the bottom?", because a scroll event is delivered a
    // frame after the scroll it reports and streaming has grown the transcript again by
    // then — mid-stream that test reads false even for our own re-pin, so the pin would
    // drop on the first token of a long answer and never come back. Direction is not
    // ambiguous that way: re-pinning only ever moves the position down, so only the
    // reader can have moved it up.
    else if (top < lastTop) pinned = false;
    lastTop = top;
  }

  // Everything that can change the distance to the bottom arrives here: a streamed token
  // growing the last bubble, a tool <details> opening, a splitter drag resizing the pane,
  // or this tab becoming visible again. Re-pinning from a ResizeObserver is what makes it
  // steady — its callbacks run after layout and before paint, so the intermediate
  // position is never painted, and they run after scroll events, so a scroll up during
  // streaming unpins before the next token could yank it back. Assigning scrollTop keeps
  // it instant; a smooth scroll would be restarted by every delta and trail the output
  // forever. An $effect rather than onMount because bind:this lands after onMount runs.
  $effect(() => {
    if (!scroller || !content) return;
    const el = scroller;
    const ro = new ResizeObserver(() => {
      if (pinned) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  });

  // Retain this view's session while the pane is mounted; the agent stops when it
  // releases — when the view, or the workspace holding it, closes.
  onMount(() => {
    session.retain();
    return () => session.release();
  });
</script>

<div class="flex h-full w-full flex-col" aria-label={title}>
  <div class="flex-1 overflow-y-auto p-3" bind:this={scroller} onscroll={onScroll}>
    <div class="space-y-2" bind:this={content}>
      {#each $items as item}
        {#if item.role === "user" || item.role === "assistant"}
          <div class="chat {item.role === 'user' ? 'chat-end' : 'chat-start'}">
            <!-- pre-wrap keeps the newlines a message was written with; break-words is
                 what handles the run of text that HAS no break in it — a URL, a path, a
                 stack frame — which otherwise widens the bubble past the pane and puts a
                 horizontal scrollbar under the whole transcript. -->
            <div class="chat-bubble break-words whitespace-pre-wrap">{item.text}</div>
          </div>
        {:else if item.role === "thinking"}
          <div class="whitespace-pre-wrap rounded bg-base-200 p-2 text-xs italic opacity-70">{item.text}</div>
        {:else if item.role === "notice"}
          <div class="rounded border border-base-300 px-2 py-1 font-mono text-xs opacity-70">{item.text}</div>
        {:else}
          <details class="rounded border border-base-300 p-2 text-xs">
            <summary class="cursor-pointer font-mono">
              {item.done ? (item.isError ? "✗" : "✓") : "…"} {item.name}
            </summary>
            <pre class="mt-1 overflow-x-auto whitespace-pre-wrap opacity-80">{item.args}{item.result ? "\n→ " + item.result : ""}</pre>
          </details>
        {/if}
      {/each}
    </div>
  </div>

  <div class="relative">
    {#if menu.length > 0}
      <ul class="absolute bottom-full left-2 right-2 mb-1 z-10 max-h-60 overflow-y-auto rounded border border-base-300 bg-base-100 shadow-lg">
        {#each menu as c, i}
          <li>
            <button
              type="button"
              class="flex w-full items-baseline gap-2 px-2 py-1 text-left text-sm {i === menuIndex ? 'bg-base-300' : ''}"
              onmousedown={(e) => { e.preventDefault(); selectCommand(c); }}
            >
              <span class="font-mono whitespace-nowrap">
                /{c.name}{#if c.argumentHint}<span class="opacity-50"> {c.argumentHint}</span>{/if}
              </span>
              <span class="truncate opacity-60">{c.description}</span>
              <span class="ml-auto whitespace-nowrap text-xs opacity-40">{c.source}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <form class="flex items-end gap-2 border-t border-base-300 p-2" onsubmit={(e) => { e.preventDefault(); session.send(); }}>
      <!-- min-h-0 undoes daisyUI's own 80px floor on .textarea, which would otherwise hold
           an empty composer four lines tall and make growing invisible until the fifth.
           max-h-48 is the ceiling past which it scrolls instead of growing further. -->
      <textarea
        class="textarea textarea-bordered max-h-48 min-h-0 flex-1 resize-none overflow-y-auto"
        rows="1"
        placeholder="Message… (/ for commands, shift+enter for a newline)"
        aria-label="Chat message"
        bind:value={$input}
        bind:this={inputEl}
        oninput={() => { dismissed = false; }}
        onkeydown={onKeydown}
        disabled={!$ready || $streaming}
      ></textarea>
      <button class="btn btn-primary" type="submit" disabled={!$ready || $streaming}>Send</button>
    </form>
  </div>

  {#if pending !== null}
    <div class="flex items-center gap-2 border-t border-base-300 bg-base-200 p-2 text-sm">
      <span class="flex-1">Starting a new chat leaves this conversation behind.</span>
      <button class="btn btn-sm btn-primary" onclick={confirmPending}>New chat</button>
      <button class="btn btn-sm btn-ghost" onclick={() => (pending = null)}>Cancel</button>
    </div>
  {/if}

  <div class="flex items-center gap-2 border-t border-base-300 p-2">
    <select class="select select-bordered select-sm" onchange={(e) => session.pickModel((e.target as HTMLSelectElement).value)} disabled={!$ready}>
      {#each $models as m}
        <option value={`${m.provider}/${m.id}`} selected={m.current}>{m.name}</option>
      {/each}
    </select>
    <select class="select select-bordered select-sm" value={$level} onchange={(e) => session.pickLevel((e.target as HTMLSelectElement).value as ThinkingLevel)} disabled={!$ready}>
      {#each levels as l}<option value={l}>think: {l}</option>{/each}
    </select>
    <button
      class="btn btn-sm btn-ghost ml-auto"
      onclick={() => (pending = { kind: "new" })}
      disabled={!$ready || $streaming}
    >New chat</button>
    {#if $streaming}
      <button class="btn btn-sm btn-error" onclick={session.stop}>Stop</button>
    {/if}
  </div>
</div>
