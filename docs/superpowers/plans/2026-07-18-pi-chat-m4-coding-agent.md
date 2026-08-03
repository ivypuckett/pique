# Pi Chat M4: Coding Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the M1 chat module from a text chatbot into a real coding
agent: enable pi's full tool set, render tool executions and thinking in the UI,
add an abort/stop control, and a model picker for the local LM Studio models.

**Architecture:** Same in-process design as M1 — pi runs in the Deno desktop
process (`src/lib/chat/agent.ts`), streaming JSON-safe events to `Chat.svelte`
over `win.bind`. M4 widens the `ChatEvent` union (tool + thinking blocks), adds
backend functions for model listing / model + thinking-level control, exposes
them as new `chat*` bindings, and extends the Svelte UI. The frontend↔backend
binding contract stays hand-synced (as documented in `bindings.ts`).

**Tech Stack:** Deno 2.9.2, `@earendil-works/pi-coding-agent@^0.80`, Svelte 5
runes, Tailwind 4 + daisyUI 5, `deno test`. Verified against a local LM Studio
server.

**Prerequisite context:**

- M1 is merged on `main`. Existing files:
  `src/lib/chat/{agent.ts,bindings.ts,Chat.svelte,agent_test.ts,bindings_test.ts}`,
  `chat*` binds in `src/desktop.ts`, `chat` entry in
  `src/lib/modules/registry.ts`.
- `agent.ts` currently: `ChatEvent` union {text,thinking,done,error}; pure
  `toFrontendEvent`; `startAgent/promptAgent/readAgent/abortAgent`; `startAgent`
  pins `modelRuntime.getModel("lmstudio","google/gemma-4-e4b")`,
  `thinkingLevel:"off"`, `tools:[]`.
- **cwd caveat (accepted):** the agent runs in `process.cwd()` = the pique repo,
  so `bash`/`edit`/`write` act on this project. Per-workspace cwd scoping is out
  of scope for M4.

**Authoritative pi types (from installed `dist/core/extensions/types.d.ts`):**

```typescript
interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: any;
}
interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: any;
  isError: boolean;
}
// AgentSession methods: setModel(model), setThinkingLevel(level), model, thinkingLevel
// ModelRuntime: getAvailable(): Promise<Model[]>, getModel(provider, id): Model | undefined
// Model: { provider: string; id: string; name: string; reasoning: boolean }
// ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
```

---

## File Structure (M4)

- Modify `src/lib/chat/agent.ts` — widen `ChatEvent`; extend `toFrontendEvent`
  for tool + (existing) thinking events; enable tools; add
  `listModels`/`setModel`/`setThinkingLevel`; export a
  `ModelInfo`/`ThinkingLevel` type for the frontend.
- Modify `src/lib/chat/agent_test.ts` — add translator cases for
  tool_start/tool_end.
- Modify `src/lib/chat/bindings.ts` — add
  `chatListModels`/`chatSetModel`/`chatSetThinking` to the interface + re-export
  the shared types.
- Modify `src/desktop.ts` — bind the three new handlers (before the top-level
  await, per the file's rule).
- Modify `src/lib/chat/Chat.svelte` — render tool/thinking blocks, add Stop
  button, model picker, thinking-level select.

No new files. `chatAbort` already exists (M1) and is reused for the Stop button.

**Extended `ChatEvent` (defined in `agent.ts`, imported by `bindings.ts` +
`Chat.svelte`):**

```typescript
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
export type ModelInfo = {
  provider: string;
  id: string;
  name: string;
  current: boolean;
};

export type ChatEvent =
  | { kind: "text"; delta: string }
  | { kind: "thinking"; delta: string }
  | { kind: "tool_start"; id: string; name: string; args: string }
  | {
    kind: "tool_end";
    id: string;
    name: string;
    result: string;
    isError: boolean;
  }
  | { kind: "done" }
  | { kind: "error"; message: string };
```

---

## Task 1: Widen event translation for tools (TDD)

**Files:**

- Modify: `src/lib/chat/agent.ts` (the `ChatEvent` type + `toFrontendEvent`,
  near the top; leave session code below untouched for now)
- Modify: `src/lib/chat/agent_test.ts`

- [ ] **Step 1: Add failing tests** — append to `src/lib/chat/agent_test.ts`:

```typescript
Deno.test("toFrontendEvent maps a tool start", () => {
  const out = toFrontendEvent({
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "bash",
    args: { command: "ls" },
  });
  assertEquals(out, {
    kind: "tool_start",
    id: "c1",
    name: "bash",
    args: '{"command":"ls"}',
  });
});

Deno.test("toFrontendEvent maps a tool end", () => {
  const out = toFrontendEvent({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "bash",
    result: "file.txt",
    isError: false,
  });
  assertEquals(out, {
    kind: "tool_end",
    id: "c1",
    name: "bash",
    result: "file.txt",
    isError: false,
  });
});

Deno.test("toFrontendEvent stringifies non-string tool results", () => {
  const out = toFrontendEvent({
    type: "tool_execution_end",
    toolCallId: "c2",
    toolName: "read",
    result: { lines: 3 },
    isError: false,
  });
  assertEquals(out, {
    kind: "tool_end",
    id: "c2",
    name: "read",
    result: '{"lines":3}',
    isError: false,
  });
});
```

- [ ] **Step 2: Run, verify new tests FAIL**

Run: `deno test -A src/lib/chat/agent_test.ts` Expected: the 3 new tests fail
(unhandled event types return `null`); the original 3 still pass.

- [ ] **Step 3: Widen `ChatEvent` and `toFrontendEvent`** in
      `src/lib/chat/agent.ts`.

Replace the existing `ChatEvent` type with the extended union (and add
`ThinkingLevel`/`ModelInfo`) shown in the File Structure section above. Then
replace the body of `toFrontendEvent` with:

```typescript
// deno-lint-ignore no-explicit-any
function preview(value: any): string {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return s.length > 2000 ? s.slice(0, 2000) + "…" : s;
}

// deno-lint-ignore no-explicit-any
export function toFrontendEvent(event: any): ChatEvent | null {
  switch (event?.type) {
    case "message_update": {
      const ev = event.assistantMessageEvent;
      if (ev?.type === "text_delta") return { kind: "text", delta: ev.delta };
      if (ev?.type === "thinking_delta") {
        return { kind: "thinking", delta: ev.delta };
      }
      return null;
    }
    case "tool_execution_start":
      return {
        kind: "tool_start",
        id: event.toolCallId,
        name: event.toolName,
        args: preview(event.args),
      };
    case "tool_execution_end":
      return {
        kind: "tool_end",
        id: event.toolCallId,
        name: event.toolName,
        result: preview(event.result),
        isError: Boolean(event.isError),
      };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run, verify all pass**

Run: `deno test -A src/lib/chat/agent_test.ts` Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/agent.ts src/lib/chat/agent_test.ts
git commit -m "feat(chat): translate tool execution events to frontend"
```

---

## Task 2: Enable tools + model/thinking control (backend)

**Files:**

- Modify: `src/lib/chat/agent.ts` (the session-lifecycle section)

- [ ] **Step 1: Enable the full tool set.** In `startAgent`, remove the
      `tools: []` line and the `thinkingLevel: "off"` line so pi uses its
      default coding tools and default thinking level. The `createAgentSession`
      call becomes:

```typescript
const created = await createAgentSession({
  model,
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});
```

Keep the existing pinned-model line
(`const model = modelRuntime.getModel("lmstudio", "google/gemma-4-e4b");`) and
the comment above it. Also keep a module reference to `modelRuntime` for the new
functions — change `const modelRuntime = await ModelRuntime.create();` so the
value is stored at module scope:

At the top of the lifecycle section (near `let session: Session | undefined;`),
add:

```typescript
// deno-lint-ignore no-explicit-any
let runtime: any | undefined;
```

and in `startAgent` replace `const modelRuntime = await ModelRuntime.create();`
with:

```typescript
runtime = await ModelRuntime.create();
const modelRuntime = runtime;
```

- [ ] **Step 2: Add the control functions.** Append to `src/lib/chat/agent.ts`:

```typescript
export async function listModels(): Promise<ModelInfo[]> {
  if (!runtime || !session) return [];
  const current = session.model;
  // deno-lint-ignore no-explicit-any
  const available: any[] = await runtime.getAvailable();
  return available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
    current: m.provider === current?.provider && m.id === current?.id,
  }));
}

export async function setModel(provider: string, id: string): Promise<void> {
  if (!runtime || !session) return;
  const model = runtime.getModel(provider, id);
  if (model) await session.setModel(model);
}

export function setThinkingLevel(level: ThinkingLevel): void {
  session?.setThinkingLevel(level);
}
```

- [ ] **Step 3: Verify existing tests still pass and the module type-checks**

Run: `deno test -A src/lib/chat/agent_test.ts` — expect 6 pass (unchanged). Run:
`deno check src/lib/chat/agent.ts` — expect no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat/agent.ts
git commit -m "feat(chat): enable coding tools and model/thinking control"
```

---

## Task 3: Bind the new backend handlers

**Files:**

- Modify: `src/desktop.ts`

- [ ] **Step 1: Add three binds.** Alongside the existing `win.bind("chat...")`
      calls (still BEFORE the first top-level `await`), add:

```typescript
win.bind("chatListModels", async () => await chat.listModels());

win.bind("chatSetModel", async (arg) => {
  const { provider, id } = arg as { provider: string; id: string };
  await chat.setModel(provider, id);
  return true;
});

win.bind("chatSetThinking", async (arg) => {
  const { level } = arg as { level: string };
  // deno-lint-ignore no-explicit-any
  chat.setThinkingLevel(level as any);
  return true;
});
```

- [ ] **Step 2: Type-check**

Run: `deno check src/desktop.ts` — expect no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/desktop.ts
git commit -m "feat(chat): expose model/thinking control bindings"
```

---

## Task 4: Extend the frontend bindings interface

**Files:**

- Modify: `src/lib/chat/bindings.ts`

- [ ] **Step 1: Add the new methods + shared types.** Update `bindings.ts` so
      the type import includes the new shared types and the interface gains
      three methods:

```typescript
import type { ChatEvent, ModelInfo, ThinkingLevel } from "./agent.ts";
export type { ChatEvent, ModelInfo, ThinkingLevel };

export interface ChatBindings {
  chatStart(): Promise<{ ok: true }>;
  chatPrompt(arg: { text: string }): Promise<unknown>;
  chatRead(): Promise<ChatEvent[]>;
  chatAbort(): Promise<unknown>;
  chatListModels(): Promise<ModelInfo[]>;
  chatSetModel(arg: { provider: string; id: string }): Promise<unknown>;
  chatSetThinking(arg: { level: ThinkingLevel }): Promise<unknown>;
}
```

Keep the existing `chatBindings()` function unchanged.

- [ ] **Step 2: Verify the null-bridge test still passes**

Run: `deno test -A src/lib/chat/bindings_test.ts` — expect 1 pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat/bindings.ts
git commit -m "feat(chat): extend bindings for model/thinking control"
```

---

## Task 5: Chat.svelte — tools, thinking, abort, model picker, thinking toggle

**Files:**

- Modify: `src/lib/chat/Chat.svelte`

This is the largest task. The message list becomes a list of typed items (text
bubbles, thinking blocks, tool blocks). A header bar holds the model picker +
thinking-level select; a Stop button appears while streaming.

- [ ] **Step 1: Replace `Chat.svelte`** with:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { chatBindings, type ChatEvent, type ModelInfo, type ThinkingLevel } from "./bindings.ts";

  let { title }: { title: string } = $props();

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
  let level = $state<ThinkingLevel>("off");

  const b = chatBindings();

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
      await b.chatStart();
      ready = true;
      models = await b.chatListModels();
      while (alive) {
        const events = await b.chatRead();
        if (!alive) break;
        for (const ev of events) apply(ev);
      }
    })();
    return () => { alive = false; };
  });

  function send() {
    const text = input.trim();
    if (!b || !ready || streaming || !text) return;
    items.push({ role: "user", text });
    input = "";
    streaming = true;
    b.chatPrompt({ text }).catch(() => { streaming = false; });
  }

  function stop() { b?.chatAbort().catch(() => {}); }

  async function pickModel(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    const m = models.find((x) => `${x.provider}/${x.id}` === value);
    if (b && m) { await b.chatSetModel({ provider: m.provider, id: m.id }); models = await b.chatListModels(); }
  }

  function pickLevel(e: Event) {
    level = (e.target as HTMLSelectElement).value as ThinkingLevel;
    b?.chatSetThinking({ level });
  }
</script>

<div class="flex h-full w-full flex-col" aria-label={title}>
  <div class="flex items-center gap-2 border-b border-base-300 p-2">
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
</div>
```

- [ ] **Step 2: Build**

Run: `deno task build` Expected: Vite build succeeds with no Svelte/TypeScript
errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat/Chat.svelte
git commit -m "feat(chat): render tools/thinking, add stop, model picker, thinking toggle"
```

---

## Task 6: End-to-end manual verification (LM Studio)

Small local models vary in tool-calling ability; use a stronger one for the tool
test.

- [ ] **Step 1: Launch** with LM Studio serving: `deno task dev`.

- [ ] **Step 2: Model picker** — open a chat module; confirm the dropdown lists
      the LM Studio models (`google/gemma-4-e4b`, `google/gemma-4-26b-a4b`,
      `qwen/qwen3.6-27b`). Select `qwen/qwen3.6-27b`.

- [ ] **Step 3: Tool use** — send: "List the files in the current directory,
      then tell me what this project is." Expected: one or more tool blocks
      appear (e.g. `bash`/`list`) showing args and a `✓`/`✗` result, followed by
      an assistant summary. Tool executions run against the pique repo (expected
      — see cwd caveat).

- [ ] **Step 4: Abort** — send a prompt that triggers a longer run; click
      **Stop** mid-stream. Expected: streaming halts, input re-enables, no
      crash.

- [ ] **Step 5: Thinking** — set the thinking select to `high`, send a question.
      Expected: a dimmed italic thinking block streams before the answer
      (model-dependent; qwen supports reasoning).

- [ ] **Step 6: Regression** — confirm `deno test -A src/` is green and a
      terminal module still opens alongside chat.

**M4 done when:** Steps 1–6 pass and `deno test -A src/` is green.

---

## Self-Review Notes

- **Spec coverage:** tool scope = full tools (Task 2); tool-call rendering
  (Tasks 1 + 5); abort button (Task 5, reuses M1 `chatAbort`); model picker
  (Tasks 2/3/4/5); thinking display + level toggle (Tasks 1/2/3/4/5). All four
  requested M4 features covered.
- **Type consistency:** `ChatEvent`, `ModelInfo`, `ThinkingLevel` defined once
  in `agent.ts`, re-exported through `bindings.ts`, consumed by `Chat.svelte`.
  New bindings `chatListModels`/`chatSetModel`/`chatSetThinking` match
  names/shapes across `agent.ts` → `desktop.ts` → `bindings.ts`.
- **JSON boundary:** tool `args`/`result` are stringified via `preview()` before
  crossing `win.bind` (they are typed `any` in pi); `ModelInfo` is plain
  strings/bool. No `Uint8Array`-style trap.
- **Deferred:** `tool_execution_update`/`partialResult` streaming (only
  start/end rendered — YAGNI); per-workspace cwd; persistent credentials
  (M2/M3); the RPC-subprocess migration (tracked separately as the napi fix).
