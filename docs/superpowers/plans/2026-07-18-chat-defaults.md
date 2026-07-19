# Persisted Chat Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the chat agent's model and thinking level across launches — apply the persisted `chat.*` settings when the agent starts, and write the user's runtime picks back to `settings.json`.

**Architecture:** The backend `startAgent()` reads `~/.pique/settings.json` (via the existing `readJson`) and resolves the model + thinking level through a new pure `resolveChatDefaults()`, with the old hardcoded model demoted to a fallback. The frontend `Chat.svelte` writes the user's model/thinking picks into the `settings` store, whose existing debounced writeback persists them. `DEFAULT_SETTINGS.chat` is seeded so frontend and backend agree on the `"off"` default.

**Tech Stack:** Deno, Svelte 5 (runes), `@earendil-works/pi-coding-agent`.

---

## File Structure

- `src/lib/chat/agent.ts` (modify) — fallback consts, `resolveChatDefaults()`, wire `startAgent()`.
- `src/lib/chat/agent_test.ts` (modify) — unit tests for `resolveChatDefaults()`.
- `src/lib/settings/bindings.ts` (modify) — seed `DEFAULT_SETTINGS.chat`.
- `src/lib/chat/Chat.svelte` (modify) — init level from settings; persist picks.

---

### Task 1: `resolveChatDefaults` (pure, test-first)

**Files:**
- Modify: `src/lib/chat/agent.ts`
- Test: `src/lib/chat/agent_test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/chat/agent_test.ts`. Add `resolveChatDefaults` to the existing import from `./agent.ts` (change the first import line to `import { resolveChatDefaults, toFrontendEvent } from "./agent.ts";`), then add:

```ts
Deno.test("resolveChatDefaults falls back on null", () => {
  assertEquals(resolveChatDefaults(null), {
    provider: "lmstudio",
    modelId: "google/gemma-4-e4b",
    thinking: "off",
  });
});

Deno.test("resolveChatDefaults falls back on empty / missing chat", () => {
  assertEquals(resolveChatDefaults({}), {
    provider: "lmstudio",
    modelId: "google/gemma-4-e4b",
    thinking: "off",
  });
  assertEquals(resolveChatDefaults({ chat: {} }), {
    provider: "lmstudio",
    modelId: "google/gemma-4-e4b",
    thinking: "off",
  });
});

Deno.test("resolveChatDefaults reads a full chat config", () => {
  assertEquals(
    resolveChatDefaults({
      chat: { defaultProvider: "openai", defaultModel: "gpt-x", defaultThinkingLevel: "high" },
    }),
    { provider: "openai", modelId: "gpt-x", thinking: "high" },
  );
});

Deno.test("resolveChatDefaults fills only the missing fields", () => {
  assertEquals(
    resolveChatDefaults({ chat: { defaultThinkingLevel: "low" } }),
    { provider: "lmstudio", modelId: "google/gemma-4-e4b", thinking: "low" },
  );
});

Deno.test("resolveChatDefaults ignores non-string values", () => {
  assertEquals(
    resolveChatDefaults({ chat: { defaultProvider: 42, defaultModel: null, defaultThinkingLevel: {} } }),
    { provider: "lmstudio", modelId: "google/gemma-4-e4b", thinking: "off" },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test -A src/lib/chat/agent_test.ts`
Expected: FAIL — `resolveChatDefaults` is not exported (import/compile error).

- [ ] **Step 3: Implement the consts and the function**

In `src/lib/chat/agent.ts`, find the current hardcoded model line inside `startAgent`:

```ts
  const model = modelRuntime.getModel("lmstudio", "google/gemma-4-e4b");
```

Add these module-level consts and the pure function near the top of the file's runtime section (e.g. immediately after the `type Session = any;` line, before `let session`):

```ts
// The startup model when nothing is persisted, or when the persisted model is
// unavailable in the runtime. Was the hardcoded M1 pin; now only the fallback.
const FALLBACK_PROVIDER = "lmstudio";
const FALLBACK_MODEL = "google/gemma-4-e4b";

// Pure projection of persisted settings → the agent's startup model + thinking.
// `settings` is whatever readJson("settings") returned: possibly null, missing
// `chat`, or holding non-string values, so every field is guarded.
export function resolveChatDefaults(
  settings: unknown,
): { provider: string; modelId: string; thinking: ThinkingLevel } {
  const chat = (settings as { chat?: Record<string, unknown> } | null)?.chat ?? {};
  const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  return {
    provider: str(chat.defaultProvider, FALLBACK_PROVIDER),
    modelId: str(chat.defaultModel, FALLBACK_MODEL),
    thinking: str(chat.defaultThinkingLevel, "off") as ThinkingLevel,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test -A src/lib/chat/agent_test.ts`
Expected: PASS — all `resolveChatDefaults` tests plus the existing `toFrontendEvent` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/agent.ts src/lib/chat/agent_test.ts
git commit -m "feat(chat): add resolveChatDefaults for persisted model/thinking"
```

---

### Task 2: Wire `startAgent()` to the resolved defaults

**Files:**
- Modify: `src/lib/chat/agent.ts`

- [ ] **Step 1: Import readJson**

At the top of `src/lib/chat/agent.ts`, the existing import block pulls from `@earendil-works/pi-coding-agent`. Add a new import line below it:

```ts
import { readJson } from "../settings/file.ts";
```

- [ ] **Step 2: Read settings and pick the model in startAgent**

In `startAgent()`, replace this block:

```ts
  runtime = await ModelRuntime.create();
  const modelRuntime = runtime;
  // M1 runs against a local LM Studio server (google/gemma-4-e4b), configured in
  // ~/.pi/agent/models.json. Pinned explicitly so pique's chat doesn't depend on
  // the user's global pi default model. (Model selection UI is a later milestone.)
  const model = modelRuntime.getModel("lmstudio", "google/gemma-4-e4b");
```

with:

```ts
  runtime = await ModelRuntime.create();
  const modelRuntime = runtime;
  // Startup model/thinking come from persisted chat defaults (~/.pique/settings.json);
  // fall back to the consts when unset or when the persisted model isn't available.
  const { provider, modelId, thinking } = resolveChatDefaults(await readJson("settings"));
  const model = modelRuntime.getModel(provider, modelId) ??
    modelRuntime.getModel(FALLBACK_PROVIDER, FALLBACK_MODEL);
```

- [ ] **Step 3: Apply the thinking level after the session is subscribed**

In `startAgent()`, find the end of the function where the subscription is set up:

```ts
  session = created.session;
  unsubscribe = session.subscribe((event: unknown) => {
    const mapped = toFrontendEvent(event);
    if (mapped) queue.push(mapped);
  });
```

Immediately after that block (still inside `startAgent`), add:

```ts
  session.setThinkingLevel(thinking);
```

- [ ] **Step 4: Verify tests + build**

Run: `deno test -A src/lib/chat/agent_test.ts`
Expected: PASS (unchanged — `resolveChatDefaults` still correct; `startAgent` isn't unit-tested).

Run: `deno run -A npm:vite build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/agent.ts
git commit -m "feat(chat): apply persisted model/thinking on agent start"
```

---

### Task 3: Seed `DEFAULT_SETTINGS.chat`

**Files:**
- Modify: `src/lib/settings/bindings.ts`

- [ ] **Step 1: Seed the default thinking level**

In `src/lib/settings/bindings.ts`, change:

```ts
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: { theme: "catppuccin-frappe" },
  chat: {},
};
```

to:

```ts
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  appearance: { theme: "catppuccin-frappe" },
  chat: { defaultThinkingLevel: "off" },
};
```

- [ ] **Step 2: Verify the settings tests still pass**

Run: `deno test -A src/lib/settings/`
Expected: PASS — `store_test.ts` and `file_test.ts` unaffected (they don't assert on `chat`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings/bindings.ts
git commit -m "feat(settings): seed default chat thinking level"
```

---

### Task 4: Persist runtime picks in Chat.svelte

**Files:**
- Modify: `src/lib/chat/Chat.svelte`

- [ ] **Step 1: Import the settings store and `get`**

In the `<script>` block of `src/lib/chat/Chat.svelte`, below the existing bindings import, add:

```ts
  import { get } from "svelte/store";
  import { settings } from "../settings/store.ts";
```

- [ ] **Step 2: Initialize the thinking level from settings**

Change:

```ts
  let level = $state<ThinkingLevel>("off");
```

to:

```ts
  let level = $state<ThinkingLevel>(get(settings).chat.defaultThinkingLevel ?? "off");
```

- [ ] **Step 3: Persist the model pick**

In `pickModel`, change:

```ts
    if (b && m) { await b.chatSetModel({ provider: m.provider, id: m.id }); models = await b.chatListModels(); }
```

to:

```ts
    if (b && m) {
      await b.chatSetModel({ provider: m.provider, id: m.id });
      settings.update((s) => ({ ...s, chat: { ...s.chat, defaultProvider: m.provider, defaultModel: m.id } }));
      models = await b.chatListModels();
    }
```

- [ ] **Step 4: Persist the thinking pick**

In `pickLevel`, change:

```ts
  function pickLevel(e: Event) {
    level = (e.target as HTMLSelectElement).value as ThinkingLevel;
    b?.chatSetThinking({ level });
  }
```

to:

```ts
  function pickLevel(e: Event) {
    level = (e.target as HTMLSelectElement).value as ThinkingLevel;
    b?.chatSetThinking({ level });
    settings.update((s) => ({ ...s, chat: { ...s.chat, defaultThinkingLevel: level } }));
  }
```

- [ ] **Step 5: Verify the build compiles**

Run: `deno run -A npm:vite build`
Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat/Chat.svelte
git commit -m "feat(chat): persist model and thinking picks to settings"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `deno test -A src/`
Expected: all tests pass (existing + new `resolveChatDefaults` tests).

- [ ] **Step 2: Desktop backend bundles**

Run: `deno run -A npm:vite build && deno desktop -A --include dist --output /tmp/pique-verify src/desktop.ts`
Expected: exit 0, "Bundle" printed. Clean up: `rm -rf /tmp/pique-verify*`.

- [ ] **Step 3: Manual end-to-end (requires desktop app + running LM Studio)**

This can't be driven headlessly. Launch `deno task dev`, then:
- In the chat controls, switch the model and the thinking level.
- Confirm `~/.pique/settings.json` now contains the chosen `chat.defaultProvider` / `chat.defaultModel` / `chat.defaultThinkingLevel` (`cat ~/.pique/settings.json`).
- Relaunch `deno task dev` and confirm the chat agent starts on that model (the model selector shows it as current) and that the thinking selector shows the persisted level.
- Sanity: with LM Studio stopped or the model renamed, confirm the agent still starts (falls back to the const model) rather than erroring.

- [ ] **Step 4: Final commit (only if fixups were needed)**

If steps 1-3 needed no changes, nothing to commit. Otherwise commit fixups with a descriptive message.

---

## Notes

- `resolveChatDefaults` is the only unit-testable seam; `startAgent` and the Svelte glue are verified by build + the manual end-to-end (both need the pi SDK / a live model).
- The frontend `settings` store is hydrated before `Chat.svelte` mounts (awaited in `main.ts`), so `get(settings)` in Step 2 of Task 4 reads persisted values, not bare defaults.
