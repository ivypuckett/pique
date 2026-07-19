<script lang="ts">
  import { onMount } from "svelte";
  import { chatBindings, type ChatEvent, type ModelInfo, type ThinkingLevel } from "./bindings.ts";
  import { get } from "svelte/store";
  import { settings } from "../settings/store.ts";

  let { title, cwd }: { title: string; cwd?: string } = $props();

  type Item =
    | { role: "user"; text: string }
    | { role: "assistant"; text: string }
    | { role: "thinking"; text: string }
    | { role: "tool"; id: string; name: string; args: string; result: string; isError: boolean; done: boolean };

  let items = $state<Item[]>([]);
  let input = $state("");
  let ready = $state(false);
  let streaming = $state(false);
  let models = $state<ModelInfo[]>([]);
  const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];
  let level = $state<ThinkingLevel>(get(settings).chat.defaultThinkingLevel ?? "off");

  const b = chatBindings();
  // This module's backend agent id, assigned once chatStart resolves.
  let id: string | undefined;

  function apply(ev: ChatEvent) {
    if (ev.kind === "text") {
      const last = items[items.length - 1];
      if (last?.role === "assistant") last.text += ev.delta;
      else items.push({ role: "assistant", text: ev.delta });
    } else if (ev.kind === "thinking") {
      const last = items[items.length - 1];
      if (last?.role === "thinking") last.text += ev.delta;
      else items.push({ role: "thinking", text: ev.delta });
    } else if (ev.kind === "tool_start") {
      items.push({ role: "tool", id: ev.id, name: ev.name, args: ev.args, result: "", isError: false, done: false });
    } else if (ev.kind === "tool_end") {
      const t = items.find((i) => i.role === "tool" && i.id === ev.id) as Extract<Item, { role: "tool" }> | undefined;
      if (t) { t.result = ev.result; t.isError = ev.isError; t.done = true; }
    } else if (ev.kind === "done" || ev.kind === "error") {
      streaming = false;
      if (ev.kind === "error") items.push({ role: "assistant", text: `⚠️ ${ev.message}` });
    }
  }

  onMount(() => {
    if (!b) {
      items.push({ role: "assistant", text: "Chat unavailable — run the desktop app (bindings are absent in a browser tab)." });
      return;
    }
    let alive = true;
    (async () => {
      const started = await b.chatStart({ cwd });
      id = started.id;
      // Unmounted while starting: stop the agent and bail (cleanup ran with id unset).
      if (!alive) { b.chatStop({ id }).catch(() => {}); return; }
      ready = true;
      models = await b.chatListModels({ id });
      while (alive) {
        const events = await b.chatRead({ id });
        if (!alive) break;
        for (const ev of events) apply(ev);
      }
    })();
    return () => {
      alive = false;
      if (id) b.chatStop({ id }).catch(() => {});
    };
  });

  function send() {
    const text = input.trim();
    if (!b || !ready || !id || streaming || !text) return;
    items.push({ role: "user", text });
    input = "";
    streaming = true;
    b.chatPrompt({ id, text }).catch(() => { streaming = false; });
  }

  function stop() { if (id) b?.chatAbort({ id }).catch(() => {}); }

  async function pickModel(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const m = models.find((x) => `${x.provider}/${x.id}` === value);
    if (b && m && id) {
      await b.chatSetModel({ id, provider: m.provider, model: m.id });
      settings.update((s) => ({ ...s, chat: { ...s.chat, defaultProvider: m.provider, defaultModel: m.id } }));
      models = await b.chatListModels({ id });
    }
  }

  function pickLevel(e: Event) {
    level = (e.target as HTMLSelectElement).value as ThinkingLevel;
    if (id) b?.chatSetThinking({ id, level });
    settings.update((s) => ({ ...s, chat: { ...s.chat, defaultThinkingLevel: level } }));
  }
</script>

<div class="flex h-full w-full flex-col" aria-label={title}>
  <div class="flex-1 space-y-2 overflow-y-auto p-3">
    {#each items as item}
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

  <form class="flex gap-2 border-t border-base-300 p-2" onsubmit={(e) => { e.preventDefault(); send(); }}>
    <input class="input input-bordered flex-1" placeholder="Message…" bind:value={input} disabled={!ready || streaming} />
    <button class="btn btn-primary" type="submit" disabled={!ready || streaming}>Send</button>
  </form>

  <div class="flex items-center gap-2 border-t border-base-300 p-2">
    <select class="select select-bordered select-sm" onchange={pickModel} disabled={!ready}>
      {#each models as m}
        <option value={`${m.provider}/${m.id}`} selected={m.current}>{m.name}</option>
      {/each}
    </select>
    <select class="select select-bordered select-sm" value={level} onchange={pickLevel} disabled={!ready}>
      {#each levels as l}<option value={l}>think: {l}</option>{/each}
    </select>
    {#if streaming}
      <button class="btn btn-sm btn-error ml-auto" onclick={stop}>Stop</button>
    {/if}
  </div>
</div>
