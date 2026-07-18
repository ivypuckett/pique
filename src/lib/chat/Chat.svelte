<script lang="ts">
  import { onMount } from "svelte";
  import { chatBindings } from "./bindings.ts";

  let { title }: { title: string } = $props();

  type Msg = { role: "user" | "assistant"; text: string };
  let messages = $state<Msg[]>([]);
  let input = $state("");
  let ready = $state(false);
  let streaming = $state(false);

  const b = chatBindings();

  onMount(() => {
    if (!b) {
      messages.push({ role: "assistant", text: "Chat unavailable — run the desktop app (bindings are absent in a browser tab)." });
      return;
    }
    let alive = true;
    (async () => {
      await b.chatStart();
      ready = true;
      while (alive) {
        const events = await b.chatRead();
        if (!alive) break;
        for (const ev of events) {
          if (ev.kind === "text") {
            const last = messages[messages.length - 1];
            if (last?.role === "assistant") last.text += ev.delta;
          } else if (ev.kind === "done") {
            streaming = false;
          } else if (ev.kind === "error") {
            streaming = false;
            messages.push({ role: "assistant", text: `⚠️ ${ev.message}` });
          }
          // ev.kind === "thinking" is ignored in M1.
        }
      }
    })();
    return () => { alive = false; };
  });

  function send() {
    const text = input.trim();
    if (!b || !ready || streaming || !text) return;
    messages.push({ role: "user", text });
    messages.push({ role: "assistant", text: "" });
    input = "";
    streaming = true;
    b.chatPrompt({ text }).catch(() => { streaming = false; });
  }
</script>

<div class="flex h-full w-full flex-col" aria-label={title}>
  <div class="flex-1 space-y-2 overflow-y-auto p-3">
    {#each messages as m}
      <div class="chat {m.role === 'user' ? 'chat-end' : 'chat-start'}">
        <div class="chat-bubble whitespace-pre-wrap">{m.text}</div>
      </div>
    {/each}
  </div>
  <form class="flex gap-2 border-t border-base-300 p-2" onsubmit={(e) => { e.preventDefault(); send(); }}>
    <input class="input input-bordered flex-1" placeholder="Message…" bind:value={input} disabled={!ready || streaming} />
    <button class="btn btn-primary" type="submit" disabled={!ready || streaming}>Send</button>
  </form>
</div>
