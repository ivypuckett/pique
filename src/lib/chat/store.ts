// One chat conversation per workspace, shared by every view's chat pane. Views stay
// mounted and only toggle visibility, so each view renders its own <Chat>; they all
// resolve to the same ChatSession here (keyed by workspaceId) and thus show the same
// transcript, input, model, and streaming state. The backend agent starts on the first
// pane's retain() and stops when the last one releases (i.e. the workspace closes).
import { get, writable, type Writable } from "svelte/store";
import { chatBindings, type ChatEvent, type CommandInfo, type ModelInfo, type ThinkingLevel } from "./bindings.ts";
import { settings } from "../settings/store.ts";

export type Item =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "thinking"; text: string }
  | { role: "tool"; id: string; name: string; args: string; result: string; isError: boolean; done: boolean };

export interface ChatSession {
  items: Writable<Item[]>;
  input: Writable<string>;
  ready: Writable<boolean>;
  streaming: Writable<boolean>;
  models: Writable<ModelInfo[]>;
  commands: Writable<CommandInfo[]>;
  level: Writable<ThinkingLevel>;
  send(): void;
  stop(): void;
  pickModel(value: string): Promise<void>;
  pickLevel(value: ThinkingLevel): void;
  retain(): void;
  release(): void;
}

function createSession(key: string, cwd: string | undefined, workspaceId: string | undefined): ChatSession {
  const b = chatBindings();
  const items = writable<Item[]>([]);
  const input = writable("");
  const ready = writable(false);
  const streaming = writable(false);
  const models = writable<ModelInfo[]>([]);
  const commands = writable<CommandInfo[]>([]);
  const level = writable<ThinkingLevel>(get(settings).chat.defaultThinkingLevel ?? "off");

  // The backend agent id, assigned once chatStart resolves.
  let id: string | undefined;
  let alive = false;
  let refs = 0;

  function apply(ev: ChatEvent) {
    if (ev.kind === "text") {
      items.update((xs) => {
        const last = xs[xs.length - 1];
        if (last?.role === "assistant") return [...xs.slice(0, -1), { ...last, text: last.text + ev.delta }];
        return [...xs, { role: "assistant", text: ev.delta }];
      });
    } else if (ev.kind === "thinking") {
      items.update((xs) => {
        const last = xs[xs.length - 1];
        if (last?.role === "thinking") return [...xs.slice(0, -1), { ...last, text: last.text + ev.delta }];
        return [...xs, { role: "thinking", text: ev.delta }];
      });
    } else if (ev.kind === "tool_start") {
      items.update((xs) => [...xs, { role: "tool", id: ev.id, name: ev.name, args: ev.args, result: "", isError: false, done: false }]);
    } else if (ev.kind === "tool_end") {
      items.update((xs) =>
        xs.map((i) => (i.role === "tool" && i.id === ev.id ? { ...i, result: ev.result, isError: ev.isError, done: true } : i))
      );
    } else if (ev.kind === "done" || ev.kind === "error") {
      streaming.set(false);
      if (ev.kind === "error") items.update((xs) => [...xs, { role: "assistant", text: `⚠️ ${ev.message}` }]);
    }
  }

  function start() {
    if (!b) {
      items.set([{ role: "assistant", text: "Chat unavailable — run the desktop app (bindings are absent in a browser tab)." }]);
      return;
    }
    alive = true;
    (async () => {
      const started = await b.chatStart({ cwd, workspaceId });
      id = started.id;
      // Torn down while starting: stop the agent and bail.
      if (!alive) { b.chatStop({ id }).catch(() => {}); id = undefined; return; }
      ready.set(true);
      models.set(await b.chatListModels({ id }));
      commands.set(await b.chatListCommands({ id }));
      while (alive) {
        const events = await b.chatRead({ id });
        if (!alive) break;
        for (const ev of events) apply(ev);
      }
    })();
  }

  return {
    items,
    input,
    ready,
    streaming,
    models,
    commands,
    level,
    send() {
      const text = get(input).trim();
      if (!b || !get(ready) || !id || get(streaming) || !text) return;
      items.update((xs) => [...xs, { role: "user", text }]);
      input.set("");
      streaming.set(true);
      b.chatPrompt({ id, text }).catch(() => streaming.set(false));
    },
    stop() {
      if (id) b?.chatAbort({ id }).catch(() => {});
    },
    async pickModel(value: string) {
      const m = get(models).find((x) => `${x.provider}/${x.id}` === value);
      if (b && m && id) {
        await b.chatSetModel({ id, provider: m.provider, model: m.id });
        settings.update((s) => ({ ...s, chat: { ...s.chat, defaultProvider: m.provider, defaultModel: m.id } }));
        models.set(await b.chatListModels({ id }));
      }
    },
    pickLevel(value: ThinkingLevel) {
      level.set(value);
      if (id) b?.chatSetThinking({ id, level: value });
      settings.update((s) => ({ ...s, chat: { ...s.chat, defaultThinkingLevel: value } }));
    },
    retain() {
      if (refs++ === 0) start();
    },
    release() {
      if (--refs > 0) return;
      // Last pane gone (workspace closed): stop the agent and drop the session so a
      // future workspace with the same id starts fresh.
      alive = false;
      if (id) b?.chatStop({ id }).catch(() => {});
      id = undefined;
      ready.set(false);
      sessions.delete(key);
    },
  };
}

const sessions = new Map<string, ChatSession>();

export function chatSession(workspaceId?: string, cwd?: string): ChatSession {
  const key = workspaceId ?? "";
  let s = sessions.get(key);
  if (!s) {
    s = createSession(key, cwd, workspaceId);
    sessions.set(key, s);
  }
  return s;
}
