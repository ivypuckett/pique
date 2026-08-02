// One chat conversation per workspace, shared by every view's chat pane. Views stay
// mounted and only toggle visibility, so each view renders its own <Chat>; they all
// resolve to the same ChatSession here (keyed by workspaceId) and thus show the same
// transcript, input, model, and streaming state. The backend agent starts on the first
// pane's retain() and stops when the last one releases (i.e. the workspace closes).
import { get, writable, type Writable } from "svelte/store";
import { chatBindings, type ChatEvent, type CommandInfo, type Item, type ModelInfo, type ThinkingLevel } from "./bindings.ts";
import { profileBindings, type ProfileInfo } from "../profiles/bindings.ts";
import { scopeBindings } from "../scope/bindings.ts";
import { patchScopeChat } from "../scope/store.ts";
import { ROOT } from "../scope/paths.ts";

// Defined next to ChatEvent in chat/agent.ts: the backend rebuilds the same Items for a
// resumed conversation, so the shape has to be one thing, not two.
export type { Item };

export interface ChatSession {
  items: Writable<Item[]>;
  input: Writable<string>;
  ready: Writable<boolean>;
  streaming: Writable<boolean>;
  models: Writable<ModelInfo[]>;
  commands: Writable<CommandInfo[]>;
  level: Writable<ThinkingLevel>;
  // The profile this conversation runs under ("" = none) and the ones it could run
  // under — its scope's own plus root's.
  profile: Writable<string>;
  profiles: Writable<ProfileInfo[]>;
  send(): void;
  stop(): void;
  pickModel(value: string): Promise<void>;
  pickLevel(value: ThinkingLevel): void;
  pickProfile(value: string): void;
  newChat(): void;
  retain(): void;
  release(): void;
}

function createSession(key: string, cwd: string | undefined, workspaceId: string | undefined): ChatSession {
  const b = chatBindings();
  // The scope this conversation runs in — what its defaults are read from and
  // written back to. A pane with no workspace id falls back to root.
  const scope = workspaceId ?? ROOT;
  const items = writable<Item[]>([]);
  const input = writable("");
  const ready = writable(false);
  const streaming = writable(false);
  const models = writable<ModelInfo[]>([]);
  const commands = writable<CommandInfo[]>([]);
  // Starts at "off" and is corrected once the scope's resolved config loads — the
  // read is async now that defaults are per-scope files rather than one settings
  // object already in memory. The backend applies the same resolved value to the
  // agent itself, so this only keeps the picker's label honest.
  const level = writable<ThinkingLevel>("off");
  // Same story for the profile: the backend resolves the scope default itself, so this
  // read only keeps the picker's label honest.
  const profile = writable("");
  const profiles = writable<ProfileInfo[]>([]);
  scopeBindings()?.scopeConfigResolve({ scope }).then((c) => {
    const l = c?.chat?.defaultThinkingLevel;
    if (l) level.set(l);
    const p = c?.chat?.defaultProfile;
    if (p) profile.set(p);
  });

  // The backend agent id, assigned once chatStart resolves.
  let id: string | undefined;
  let alive = false;
  let refs = 0;
  // Bumped on every start. The read loop below carries the generation it began with and
  // stops as soon as a newer one exists: `alive` alone is not enough, because a restart
  // sets it back to true while the previous loop is still parked in a chatRead long-poll
  // (up to 20s), and that loop would then apply the OLD agent's events to the NEW
  // transcript.
  let generation = 0;

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

  // `profileName` is undefined on the first start (let the backend apply the scope
  // default) and an explicit name — possibly "" — on a restart. `fresh` asks the backend
  // to begin a new conversation rather than resume the scope's saved one.
  function start(profileName?: string, fresh?: boolean) {
    if (!b) {
      items.set([{ role: "assistant", text: "Chat unavailable — run the desktop app (bindings are absent in a browser tab)." }]);
      return;
    }
    alive = true;
    const gen = ++generation;
    const current = () => alive && gen === generation;
    (async () => {
      const started = await b.chatStart({ cwd, scope: workspaceId, profile: profileName, fresh });
      // What the resumed conversation already holds, read before the id is published so
      // a start that loses the race cannot paint its transcript over the winner's.
      const history = await b.chatHistory({ id: started.id });
      // Torn down or restarted while starting: stop this agent and bail without
      // publishing its id, so the newer start owns the session.
      if (!current()) { b.chatStop({ id: started.id }).catch(() => {}); return; }
      id = started.id;
      items.set(history);
      ready.set(true);
      profiles.set(await profileBindings()?.profilesVisible({ scope }) ?? []);
      models.set(await b.chatListModels({ id }));
      commands.set(await b.chatListCommands({ id }));
      while (current()) {
        const events = await b.chatRead({ id });
        if (!current()) break;
        for (const ev of events) apply(ev);
      }
    })();
  }

  // Stop the live agent and start another on a new conversation. Neither the system
  // prompt nor the session file can be swapped on a running pi session, so both callers
  // — switching profile and starting a new chat — have to go through a restart, and both
  // want a new conversation rather than the saved one resumed.
  function restart(profileName: string) {
    if (id) b?.chatStop({ id }).catch(() => {});
    id = undefined;
    alive = false;
    items.set([]);
    streaming.set(false);
    ready.set(false);
    start(profileName, true);
  }

  return {
    items,
    input,
    ready,
    streaming,
    models,
    commands,
    level,
    profile,
    profiles,
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
        // The pick becomes THIS scope's default, not the app's — a workspace that
        // picks a model stops inheriting root's, and every other workspace is
        // unaffected.
        patchScopeChat(scope, { defaultProvider: m.provider, defaultModel: m.id });
        models.set(await b.chatListModels({ id }));
      }
    },
    pickLevel(value: ThinkingLevel) {
      level.set(value);
      if (id) b?.chatSetThinking({ id, level: value });
      patchScopeChat(scope, { defaultThinkingLevel: value });
    },
    // A profile cannot be applied to a live agent — pi fixes the system prompt at session
    // creation — so this restarts, which is why the transcript goes with it. The pick
    // becomes the scope's default, as pickModel's does.
    pickProfile(value: string) {
      if (value === get(profile)) return;
      profile.set(value);
      patchScopeChat(scope, { defaultProfile: value });
      restart(value);
    },
    // Put the saved conversation behind us and begin another under the same profile. The
    // old session file stays on disk; it is simply no longer the most recent one.
    newChat() {
      restart(get(profile));
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
