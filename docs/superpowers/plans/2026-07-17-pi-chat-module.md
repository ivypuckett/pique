# Pi Chat Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `chat` module to pique: an embedded pi.dev coding agent whose replies stream into a Svelte pane, wired through deno-desktop bindings exactly like the existing terminal module.

**Architecture:** pi runs **in-process in the Deno desktop process** (`createAgentSession()` from `@earendil-works/pi-coding-agent`, spike-verified under Deno 2.9.2). A Deno-side wrapper (`src/lib/chat/agent.ts`) owns one agent session and a JSON-safe event queue; `src/desktop.ts` exposes `chatStart`/`chatPrompt`/`chatRead`/`chatAbort` `win.bind` handlers; `Chat.svelte` calls them and long-polls `chatRead`, mirroring `Terminal.svelte`'s read loop. The webview (Svelte frontend) never touches pi or credentials.

**Tech Stack:** Deno 2.9.2, `@earendil-works/pi-coding-agent@^0.80`, Svelte 5, Tailwind 4 + daisyUI 5, `deno test`.

**Scope:** This plan details **M1 only** (the streaming vertical slice) to executable granularity. M2–M4 (persistent credential store, in-app auth UI, tool/model polish) are a roadmap at the end; each gets its own detailed plan after M1 lands and proves the pipe.

---

## File Structure (M1)

- Create `src/lib/chat/agent.ts` — Deno-side wrapper: owns the pi session + JSON-safe event queue. Exports the pure `toFrontendEvent()` translator and the session lifecycle (`startAgent`, `promptAgent`, `readAgent`, `abortAgent`).
- Create `src/lib/chat/agent_test.ts` — unit tests for `toFrontendEvent()` (no pi, no API key needed).
- Create `src/lib/chat/bindings.ts` — frontend typed bridge (mirrors `src/lib/terminal/bindings.ts`).
- Create `src/lib/chat/bindings_test.ts` — null-bridge test (mirrors `src/lib/terminal/bindings_test.ts`).
- Create `src/lib/chat/Chat.svelte` — the module UI: message list + input, calls bindings, long-polls `chatRead`.
- Modify `src/desktop.ts` — register `chat*` bindings (before the top-level `await`, per the file's documented constraint).
- Modify `src/lib/modules/registry.ts` — add `chat: Chat`.
- Modify `deno.json` — add the `@earendil-works/pi-coding-agent` import.

**Shared frontend event type** (defined once in `agent.ts`, imported by `bindings.ts` and `Chat.svelte`):

```typescript
export type ChatEvent =
  | { kind: "text"; delta: string }
  | { kind: "thinking"; delta: string }
  | { kind: "done" }
  | { kind: "error"; message: string };
```

---

## Task 1: Add the dependency

**Files:**
- Modify: `deno.json` (imports block, after `"@std/http"`)

- [ ] **Step 1: Add the import map entry**

In `deno.json`, add to `"imports"`:

```json
    "@earendil-works/pi-coding-agent": "npm:@earendil-works/pi-coding-agent@^0.80"
```

- [ ] **Step 2: Cache it and confirm it resolves under Deno**

Run: `deno cache npm:@earendil-works/pi-coding-agent@^0.80`
Expected: downloads complete, no resolution error. (A one-time `Warning: Ignored build scripts` for `@google/genai`/`protobufjs` is expected and harmless — `nodeModulesDir: "auto"` is already set in `deno.json`.)

- [ ] **Step 3: Commit**

```bash
git add deno.json deno.lock
git commit -m "feat(chat): add pi-coding-agent dependency"
```

---

## Task 2: Pure event translator (`toFrontendEvent`)

The one piece of real logic we can test without a network call: mapping pi's SDK events to the JSON-safe `ChatEvent` the frontend consumes. Binding values must be plain JSON (same constraint as `termRead` returning `number[]`), so the frontend never sees raw SDK event objects.

**Files:**
- Create: `src/lib/chat/agent.ts`
- Test: `src/lib/chat/agent_test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/chat/agent_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { toFrontendEvent } from "./agent.ts";

Deno.test("toFrontendEvent maps a text delta", () => {
  const out = toFrontendEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Hel" },
  });
  assertEquals(out, { kind: "text", delta: "Hel" });
});

Deno.test("toFrontendEvent maps a thinking delta", () => {
  const out = toFrontendEvent({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
  });
  assertEquals(out, { kind: "thinking", delta: "hmm" });
});

Deno.test("toFrontendEvent ignores unrelated events", () => {
  assertEquals(toFrontendEvent({ type: "agent_start" }), null);
  assertEquals(
    toFrontendEvent({ type: "message_update", assistantMessageEvent: { type: "text_end" } }),
    null,
  );
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `deno test -A src/lib/chat/agent_test.ts`
Expected: FAIL — `Module not found` / `toFrontendEvent is not exported`.

- [ ] **Step 3: Write the minimal translator**

Create `src/lib/chat/agent.ts` with just the type and the pure function (session wiring comes in Task 3):

```typescript
// Deno-side pi agent wrapper. Runs in the desktop process only.
// `toFrontendEvent` is the pure, JSON-safe projection of pi's SDK events that
// crosses the win.bind boundary — keep its output plain JSON (see bindings.ts).

export type ChatEvent =
  | { kind: "text"; delta: string }
  | { kind: "thinking"; delta: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

// deno-lint-ignore no-explicit-any
export function toFrontendEvent(event: any): ChatEvent | null {
  if (event?.type === "message_update") {
    const ev = event.assistantMessageEvent;
    if (ev?.type === "text_delta") return { kind: "text", delta: ev.delta };
    if (ev?.type === "thinking_delta") return { kind: "thinking", delta: ev.delta };
  }
  return null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `deno test -A src/lib/chat/agent_test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/agent.ts src/lib/chat/agent_test.ts
git commit -m "feat(chat): add JSON-safe SDK event translator"
```

---

## Task 3: Session lifecycle + event queue (Deno side)

Wrap one pi session and a drain-on-poll event queue, mirroring how `pty.ts` backs the terminal bindings. `promptAgent` kicks off the run **without awaiting completion** (so streaming can flow through `readAgent`); the run's end/failure is pushed onto the queue as `done`/`error` from the prompt promise.

**Files:**
- Modify: `src/lib/chat/agent.ts`

- [ ] **Step 1: Add session state, queue, and lifecycle functions**

Append to `src/lib/chat/agent.ts`:

```typescript
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  // deno-lint-ignore no-explicit-any
} from "@earendil-works/pi-coding-agent";

// deno-lint-ignore no-explicit-any
type Session = any;

let session: Session | undefined;
let unsubscribe: (() => void) | undefined;
const queue: ChatEvent[] = [];

export async function startAgent(): Promise<void> {
  if (session) return;
  const modelRuntime = await ModelRuntime.create();
  const created = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
    tools: [], // M1: pure text chat. Tools (bash/read/edit) are enabled in M4.
  });
  session = created.session;
  unsubscribe = session.subscribe((event: unknown) => {
    const mapped = toFrontendEvent(event);
    if (mapped) queue.push(mapped);
  });
}

export function promptAgent(text: string): void {
  if (!session) throw new Error("chat agent not started");
  // Do not await: let streaming flow through readAgent. Completion/failure is
  // reported by pushing a terminal event onto the queue.
  session
    .prompt(text)
    .then(() => {
      queue.push(
        session.agent?.state?.errorMessage
          ? { kind: "error", message: String(session.agent.state.errorMessage) }
          : { kind: "done" },
      );
    })
    .catch((err: unknown) => {
      queue.push({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    });
}

// Long-poll drain: return queued events, or [] after ~20s so the frontend re-polls.
export async function readAgent(): Promise<ChatEvent[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (queue.length) return queue.splice(0, queue.length);
    await new Promise((r) => setTimeout(r, 15));
  }
  return [];
}

export async function abortAgent(): Promise<void> {
  await session?.abort();
}
```

- [ ] **Step 2: Verify the existing translator tests still pass and the module type-checks**

Run: `deno test -A src/lib/chat/agent_test.ts`
Expected: PASS (3 tests, unchanged).

Run: `deno check src/lib/chat/agent.ts`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat/agent.ts
git commit -m "feat(chat): wire pi session lifecycle and event queue"
```

---

## Task 4: Frontend bindings bridge

**Files:**
- Create: `src/lib/chat/bindings.ts`
- Test: `src/lib/chat/bindings_test.ts`

- [ ] **Step 1: Write the failing null-bridge test**

`src/lib/chat/bindings_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { chatBindings } from "./bindings.ts";

Deno.test("chatBindings returns null when the bridge is absent (browser/test)", () => {
  assertEquals(chatBindings(), null);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `deno test -A src/lib/chat/bindings_test.ts`
Expected: FAIL — module/`chatBindings` not found.

- [ ] **Step 3: Write the bridge**

`src/lib/chat/bindings.ts`:

```typescript
// Frontend half of the chat binding contract. The backend half is the chat*
// win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by hand
// (separate module graphs, nothing cross-checks them at compile time).
import type { ChatEvent } from "./agent.ts";

export interface ChatBindings {
  chatStart(): Promise<{ ok: true }>;
  chatPrompt(arg: { text: string }): Promise<unknown>;
  chatRead(): Promise<ChatEvent[]>;
  chatAbort(): Promise<unknown>;
}

export function chatBindings(): ChatBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ChatBindings) : null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `deno test -A src/lib/chat/bindings_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/bindings.ts src/lib/chat/bindings_test.ts
git commit -m "feat(chat): add frontend bindings bridge"
```

---

## Task 5: Register the backend bindings

**Files:**
- Modify: `src/desktop.ts`

pi is heavier than the PTY and must not block binding registration. Follow the file's rule: register all `win.bind` handlers **before** any top-level `await`, referencing a `chat` module assigned after the awaits (handlers only run on user interaction, long after assignment).

- [ ] **Step 1: Declare the deferred chat module and bind handlers**

In `src/desktop.ts`, after the `let term: ...;` declaration add:

```typescript
let chat: typeof import("./lib/chat/agent.ts");
```

Then, alongside the `win.bind("term...")` calls (still before the top-level `await`), add:

```typescript
win.bind("chatStart", async () => {
  await chat.startAgent();
  return { ok: true };
});

win.bind("chatPrompt", async (arg) => {
  const { text } = arg as { text: string };
  chat.promptAgent(text);
  return true;
});

win.bind("chatRead", async () => await chat.readAgent());

win.bind("chatAbort", async () => {
  await chat.abortAgent();
  return true;
});
```

- [ ] **Step 2: Load the chat module next to the term import**

Change the deps-loading line. Find:

```typescript
term = await import("./lib/terminal/pty.ts");
```

Add immediately after it:

```typescript
chat = await import("./lib/chat/agent.ts");
```

- [ ] **Step 3: Type-check the entry**

Run: `deno check src/desktop.ts`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/desktop.ts
git commit -m "feat(chat): expose chat bindings from desktop backend"
```

---

## Task 6: Chat.svelte UI + registry

**Files:**
- Create: `src/lib/chat/Chat.svelte`
- Modify: `src/lib/modules/registry.ts`

- [ ] **Step 1: Write the component**

`src/lib/chat/Chat.svelte` — message list + input; on mount, start the agent and long-poll `chatRead`, mirroring `Terminal.svelte`'s `alive`-guarded loop:

```svelte
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
```

- [ ] **Step 2: Register the module**

In `src/lib/modules/registry.ts`, import and add the entry:

```typescript
import Chat from "../chat/Chat.svelte";
```

```typescript
export const registry: Record<string, Component<{ title: string }>> = {
  placeholder: Placeholder,
  terminal: Terminal,
  chat: Chat,
};
```

- [ ] **Step 3: Build to verify it compiles**

Run: `deno task build`
Expected: Vite build succeeds, no Svelte/TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat/Chat.svelte src/lib/modules/registry.ts
git commit -m "feat(chat): add Chat.svelte and register chat module"
```

---

## Task 7: End-to-end manual verification (with a temporary key)

The streaming round-trip needs real credentials, which unit tests cannot cover. This is the M1 acceptance gate (equivalent to how the PTY path was verified end-to-end).

- [ ] **Step 1: Run the desktop app with a temporary key**

```bash
ANTHROPIC_API_KEY=sk-ant-... deno task dev
```

(The key is scaffolding for M1 only — M2/M3 replace it with a stored credential. Never commit it.)

- [ ] **Step 2: Open a chat module and send a message**

Open a `chat` module in a workspace pane, type "Say hi in one word", press Send.
Expected: an assistant bubble appears and **text streams into it token-by-token**, then the input re-enables.

- [ ] **Step 3: Verify the failure path**

Restart with no key: `deno task dev`. Send a message.
Expected: an assistant bubble shows `⚠️ Connection error.` (or similar) and the input re-enables — no hang, no crash of the terminal module.

- [ ] **Step 4: Confirm the terminal module still works**

Open a terminal module in another pane; confirm it starts and echoes input.
Expected: unaffected — chat and terminal coexist.

**M1 done when:** Steps 1–4 pass and `deno test -A src/` is green.

---

## Roadmap: M2–M4 (detailed after M1 lands)

Each becomes its own plan. Sketched here so M1's structure anticipates them.

**M2 — Persistent credentials.** Implement a file-backed `CredentialStore` (contract: `read`/`list`/`modify`/`delete`, one `{ type: "api_key", key }` per provider) persisted under pique's config dir, and inject it so `ModelRuntime` resolves a stored key with the env var unset. *Open API to confirm before writing M2:* how `ModelRuntime.create()` accepts a custom credential store (or whether to drop to `builtinModels({ credentials })` + a custom `ModelRuntime`). Verify: key set once survives an app restart; env var unset; chat still streams.

**M3 — In-app auth UI.** A daisyUI settings pane (provider dropdown + key field) that writes to the M2 store via a new `chatSetCredential` binding; surface "no credential configured" as a first-class empty state in `Chat.svelte`. Verify: with env unset and store empty, the pane accepts a key and the very next message streams.

**M4 — Coding-agent polish.** Enable real tools (`tools: ["read", "bash", ...]` instead of `[]`), render `tool_execution_start/update/end` events (extend `toFrontendEvent` + `ChatEvent`), add a model picker (`setModel`/`cycleModel`), thinking-level control, thinking-delta rendering, and an Abort button (`chatAbort`). Verify: agent runs a tool against the workspace and the call renders; abort stops a run mid-stream.

---

## Self-Review Notes

- **Spec coverage:** M1 delivers the "streaming slice" milestone end-to-end (dep → translator → session/queue → bindings → UI → manual verify). M2–M4 map to the milestone roadmap agreed in planning.
- **Type consistency:** `ChatEvent` is defined once in `agent.ts` and imported by `bindings.ts` and `Chat.svelte`. Binding names (`chatStart`/`chatPrompt`/`chatRead`/`chatAbort`) and shapes match across `agent.ts`, `desktop.ts`, and `bindings.ts`. `chatRead` returns `ChatEvent[]` on both sides.
- **Deno/JSON boundary:** `readAgent` returns already-JSON-safe `ChatEvent[]` (strings only), so no `Uint8Array`-style serialization trap as with `termRead`.
- **Known runtime caveat:** `tools: []` in M1 keeps the agent from executing bash mid-slice; real tools arrive in M4.
