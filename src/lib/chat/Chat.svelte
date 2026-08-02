<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { CommandInfo, ThinkingLevel } from "./bindings.ts";
  import { chatSession } from "./store.ts";

  let { title, cwd, workspaceId }: { title: string; cwd?: string; workspaceId?: string } =
    $props();

  // The conversation lives in a per-workspace session, so every view's chat pane shows
  // the same transcript and input. This component is a thin view over it. workspaceId is
  // fixed for this instance (the tree is keyed by it) and cwd only seeds a new session,
  // so we deliberately read both once at creation — untrack tells Svelte that's intended.
  const session = untrack(() => chatSession(workspaceId, cwd));
  const { items, input, ready, streaming, models, level, profile, profiles } = session;
  const commands = session.commands;

  const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];

  // Both of these leave the current conversation behind — switching profile because pi
  // fixes the system prompt at session creation, a new chat because that is the point —
  // so each is held here until confirmed. Held here rather than in the store: until it is
  // confirmed, nothing about the conversation has changed. The profile select shows the
  // pending choice, so cancelling visibly puts it back.
  let pending = $state<{ kind: "profile"; profile: string } | { kind: "new" } | null>(null);

  function confirmPending() {
    const p = pending;
    pending = null;
    if (p?.kind === "profile") session.pickProfile(p.profile);
    else if (p?.kind === "new") session.newChat();
  }

  // `/` command menu (skills / prompt templates / extension commands). Loaded once
  // the agent is ready; session.prompt() expands/runs them, so this is pure compose UI.
  let menuIndex = $state(0);
  let dismissed = $state(false);
  let inputEl = $state<HTMLInputElement>();
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
    if (menu.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); menuIndex = (menuIndex + 1) % menu.length; }
    else if (e.key === "ArrowUp") { e.preventDefault(); menuIndex = (menuIndex - 1 + menu.length) % menu.length; }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectCommand(menu[menuIndex]); }
    else if (e.key === "Escape") { e.preventDefault(); dismissed = true; }
  }

  // Retain the shared session while any pane is mounted; the agent stops when the last
  // one (the workspace's final view) releases.
  onMount(() => {
    session.retain();
    return () => session.release();
  });
</script>

<div class="flex h-full w-full flex-col" aria-label={title}>
  <div class="flex-1 space-y-2 overflow-y-auto p-3">
    {#each $items as item}
      {#if item.role === "user" || item.role === "assistant"}
        <div class="chat {item.role === 'user' ? 'chat-end' : 'chat-start'}">
          <div class="chat-bubble whitespace-pre-wrap">{item.text}</div>
        </div>
      {:else if item.role === "thinking"}
        <div class="whitespace-pre-wrap rounded bg-base-200 p-2 text-xs italic opacity-70">{item.text}</div>
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
              <span class="font-mono whitespace-nowrap">/{c.name}</span>
              <span class="truncate opacity-60">{c.description}</span>
              <span class="ml-auto whitespace-nowrap text-xs opacity-40">{c.source}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <form class="flex gap-2 border-t border-base-300 p-2" onsubmit={(e) => { e.preventDefault(); session.send(); }}>
      <input
        class="input input-bordered flex-1"
        placeholder="Message… (/ for commands)"
        bind:value={$input}
        bind:this={inputEl}
        oninput={() => { dismissed = false; }}
        onkeydown={onKeydown}
        disabled={!$ready || $streaming}
      />
      <button class="btn btn-primary" type="submit" disabled={!$ready || $streaming}>Send</button>
    </form>
  </div>

  {#if pending !== null}
    <div class="flex items-center gap-2 border-t border-base-300 bg-base-200 p-2 text-sm">
      <span class="flex-1">
        {#if pending.kind === "profile"}
          Switching to <strong>{pending.profile === "" ? "base" : pending.profile}</strong>
          starts a new conversation.
        {:else}
          Starting a new chat leaves this conversation behind.
        {/if}
      </span>
      <button class="btn btn-sm btn-primary" onclick={confirmPending}>
        {pending.kind === "profile" ? "Switch" : "New chat"}
      </button>
      <button class="btn btn-sm btn-ghost" onclick={() => (pending = null)}>Cancel</button>
    </div>
  {/if}

  <div class="flex items-center gap-2 border-t border-base-300 p-2">
    <select
      class="select select-bordered select-sm"
      value={pending?.kind === "profile" ? pending.profile : $profile}
      onchange={(e) => {
        const value = (e.target as HTMLSelectElement).value;
        pending = value === $profile ? null : { kind: "profile", profile: value };
      }}
      disabled={!$ready || $streaming}
    >
      <!-- "" is the absence of a profile: the scope's base prompt and nothing appended. -->
      <option value="">base</option>
      {#each $profiles as p}
        <option value={p.name} title={p.description ?? ""}>{p.name}</option>
      {/each}
    </select>
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
