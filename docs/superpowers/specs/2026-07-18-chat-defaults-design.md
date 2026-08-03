# Persisted Chat Defaults

## Goal

Make the chat agent's model and thinking level persist across launches. The
`chat.*` fields already exist in the settings schema (`settings/bindings.ts`)
but nothing reads or writes them. Wire both halves: apply the persisted defaults
when the agent starts, and persist the user's runtime choices.

## Background

- `startAgent()` in `src/lib/chat/agent.ts` hardcodes the model (`lmstudio` /
  `google/gemma-4-e4b`, the M1 pin) and never sets a thinking level.
- `src/lib/chat/Chat.svelte` already changes both at runtime via the
  `chatSetModel` / `chatSetThinking` bindings (`pickModel` / `pickLevel`), but
  the choices are lost on the next launch.
- `~/.pique/settings.json` is backend-owned and readable Deno-side via
  `readJson` in `src/lib/settings/file.ts`.

## Behavior

- On agent start, the model and thinking level come from the persisted
  `chat.defaultProvider` / `chat.defaultModel` / `chat.defaultThinkingLevel`.
- When the user picks a different model or thinking level in the chat controls,
  it applies live (unchanged) **and** is written to the settings store, which
  debounce-persists to `settings.json` — so the next launch starts there.
- Fallbacks: if no model default is persisted, or the persisted model isn't
  available in the runtime (e.g. LM Studio not running), the agent falls back to
  the hardcoded consts. If no thinking default is persisted, it is `"off"`. A
  bad persisted model degrades silently to the fallback rather than erroring.

**Consequence:** the agent's startup model becomes user-controlled; the former
M1 pin in `startAgent` is now only the fallback. This is intended.

## Components

### `src/lib/chat/agent.ts` (modify)

- Add module consts `FALLBACK_PROVIDER = "lmstudio"` and
  `FALLBACK_MODEL = "google/gemma-4-e4b"`.
- Add an exported pure function:

  ```ts
  export function resolveChatDefaults(
    settings: unknown,
  ): { provider: string; modelId: string; thinking: ThinkingLevel };
  ```

  It reads `settings.chat.defaultProvider/defaultModel/defaultThinkingLevel`,
  defensively (settings may be `null`, missing `chat`, or hold non-string
  values), returning the consts / `"off"` for anything absent or non-string.
- `startAgent()`: `const s = await readJson("settings");` then
  `const { provider, modelId, thinking } = resolveChatDefaults(s);`. Pick the
  model via `modelRuntime.getModel(provider, modelId)`, and if that is falsy,
  `modelRuntime.getModel(FALLBACK_PROVIDER, FALLBACK_MODEL)`. After the session
  is created and subscribed, call `session.setThinkingLevel(thinking)`.
- Import `readJson` from `../settings/file.ts` (both Deno-side).

### `src/lib/chat/Chat.svelte` (modify)

- Import the `settings` store from `../settings/store.ts` and `get` from
  `svelte/store`.
- Initialize `level` from `get(settings).chat.defaultThinkingLevel ?? "off"`
  instead of the literal `"off"` (the store is hydrated before mount).
- `pickModel`: after `chatSetModel`, persist via
  `settings.update(s => ({ ...s, chat: { ...s.chat, defaultProvider: m.provider, defaultModel: m.id } }))`.
- `pickLevel`: after `chatSetThinking`, persist via
  `settings.update(s => ({ ...s, chat: { ...s.chat, defaultThinkingLevel: level } }))`.

### `src/lib/settings/bindings.ts` (modify)

- Seed `DEFAULT_SETTINGS.chat = { defaultThinkingLevel: "off" }` so the frontend
  default matches the backend `"off"` fallback.

## Testing / Verification

- **Unit** (`src/lib/chat/agent_test.ts`, extend the existing file): cover
  `resolveChatDefaults` for: null input; empty object; missing `chat`; full
  `chat` with all three fields; partial `chat` (only one field set); non-string
  field values (e.g. numbers) falling back. `resolveChatDefaults` is pure and
  imports no agent runtime, so it tests without the pi SDK.
- **Build / typecheck:** `deno task test`, `vite build`, and the `deno desktop`
  bundle stay green.
- **Manual end-to-end (user):** needs the desktop app AND a running LM Studio.
  Change the model and thinking level in the chat controls, relaunch
  `deno task dev`, and confirm the agent starts with those values and that
  `~/.pique/settings.json` holds the chosen `chat.*`. This cannot be driven
  headlessly.

## Non-goals

- No change to the set of thinking levels the UI offers (still off/low/
  medium/high). Persisting a value outside that set (only possible by hand-
  editing the file) is not handled specially.
- No model-management UI beyond the existing picker.
