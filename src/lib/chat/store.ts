// One chat conversation per view: a workspace's views each hold their own thread, so
// two views side by side are two contexts rather than one transcript shown twice.
// Sessions are keyed by workspace AND view here; what the view does NOT get its own of
// is the scope — tools, model defaults, board and cwd all still resolve against the
// workspace (see scope/paths.ts). The backend agent starts on the pane's retain() and
// stops when it releases (i.e. the view or its workspace closes).
import { get, type Writable, writable } from "svelte/store";
import {
  chatBindings,
  type ChatEvent,
  type CommandInfo,
  type Item,
  type ModelInfo,
  type ReloadSummary,
  type ThinkingLevel,
} from "./bindings.ts";
import { scopeBindings } from "../scope/bindings.ts";
import { patchScopeChat } from "../scope/store.ts";
import { ROOT } from "../scope/paths.ts";

// Defined next to ChatEvent in chat/agent.ts: the backend rebuilds the same Items for a
// resumed conversation, so the shape has to be one thing, not two.
export type { Item };

// The line `/reload` leaves in the transcript. A reload that changes nothing still says
// so — silence would be indistinguishable from a command that did not register — and a
// failed extension is named first, because that is the case the user has to act on.
export function formatReloadNotice(summary: ReloadSummary): string {
  const parts: string[] = [];
  for (const f of summary.failed) {
    parts.push(`⚠ ${f.name} failed to load: ${f.error.split("\n")[0]}`);
  }
  if (summary.added.length) parts.push(`+${summary.added.join(" +")}`);
  if (summary.removed.length) parts.push(`−${summary.removed.join(" −")}`);
  if (!summary.added.length && !summary.removed.length) {
    parts.push("no tool changes");
  }
  return `Reloaded — ${parts.join("; ")}`;
}

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
  refreshCommands(): Promise<void>;
  pickModel(value: string): Promise<void>;
  pickLevel(value: ThinkingLevel): void;
  newChat(): void;
  retain(): void;
  release(): void;
}

function createSession(
  key: string,
  cwd: string | undefined,
  workspaceId: string | undefined,
  viewId: string | undefined,
): ChatSession {
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
  scopeBindings()?.scopeConfigResolve({ scope }).then((c) => {
    const l = c?.chat?.defaultThinkingLevel;
    if (l) level.set(l);
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
        if (last?.role === "assistant") {
          return [...xs.slice(0, -1), { ...last, text: last.text + ev.delta }];
        }
        return [...xs, { role: "assistant", text: ev.delta }];
      });
    } else if (ev.kind === "thinking") {
      items.update((xs) => {
        const last = xs[xs.length - 1];
        if (last?.role === "thinking") {
          return [...xs.slice(0, -1), { ...last, text: last.text + ev.delta }];
        }
        return [...xs, { role: "thinking", text: ev.delta }];
      });
    } else if (ev.kind === "tool_start") {
      items.update((
        xs,
      ) => [...xs, {
        role: "tool",
        id: ev.id,
        name: ev.name,
        args: ev.args,
        result: "",
        isError: false,
        done: false,
      }]);
    } else if (ev.kind === "tool_end") {
      items.update((xs) =>
        xs.map((
          i,
        ) => (i.role === "tool" && i.id === ev.id
          ? { ...i, result: ev.result, isError: ev.isError, done: true }
          : i)
        )
      );
    } else if (ev.kind === "done" || ev.kind === "error") {
      streaming.set(false);
      if (ev.kind === "error") {
        items.update((
          xs,
        ) => [...xs, { role: "assistant", text: `⚠️ ${ev.message}` }]);
      }
    }
  }

  // What `/reload` runs. Re-lists the `/` menu afterwards because a newly loaded
  // extension can register commands of its own, and reports the outcome in the
  // transcript — including the load failures pi's reload swallows.
  async function reload() {
    if (!b || !id) return;
    try {
      const summary = await b.chatReload({ id });
      items.update((xs) => [...xs, {
        role: "notice",
        text: formatReloadNotice(summary),
      }]);
      commands.set(await b.chatListCommands({ id }));
    } catch (err) {
      items.update((xs) => [...xs, {
        role: "notice",
        text: `Reload failed — ${err instanceof Error ? err.message : err}`,
      }]);
    }
  }

  // `fresh` asks the backend to begin a new conversation rather than resume the view's
  // saved one.
  function start(fresh?: boolean) {
    if (!b) {
      items.set([{
        role: "assistant",
        text:
          "Chat unavailable — run the desktop app (bindings are absent in a browser tab).",
      }]);
      return;
    }
    alive = true;
    const gen = ++generation;
    const current = () => alive && gen === generation;
    (async () => {
      const started = await b.chatStart({
        cwd,
        scope: workspaceId,
        view: viewId,
        fresh,
      });
      // What the resumed conversation already holds, read before the id is published so
      // a start that loses the race cannot paint its transcript over the winner's.
      const history = await b.chatHistory({ id: started.id });
      // Torn down or restarted while starting: stop this agent and bail without
      // publishing its id, so the newer start owns the session.
      if (!current()) {
        b.chatStop({ id: started.id }).catch(() => {});
        return;
      }
      id = started.id;
      items.set(history);
      ready.set(true);
      models.set(await b.chatListModels({ id }));
      commands.set(await b.chatListCommands({ id }));
      while (current()) {
        const events = await b.chatRead({ id });
        if (!current()) break;
        for (const ev of events) apply(ev);
      }
    })();
  }

  // Stop the live agent and start another on a new conversation. The session file cannot
  // be swapped on a running pi session, so starting a new chat has to go through a
  // restart, and wants a new conversation rather than the saved one resumed.
  function restart() {
    if (id) b?.chatStop({ id }).catch(() => {});
    id = undefined;
    alive = false;
    items.set([]);
    streaming.set(false);
    ready.set(false);
    start(true);
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
      // pique's own command, handled here rather than sent: pi does not expand it, so
      // `session.prompt("/reload")` would just ask the model about the word "/reload".
      // No model turn, so `streaming` stays false and the input is usable immediately.
      if (text === "/reload") {
        reload();
        return;
      }
      streaming.set(true);
      b.chatPrompt({ id, text }).catch(() => streaming.set(false));
    },
    stop() {
      if (id) b?.chatAbort({ id }).catch(() => {});
    },
    // Re-read prompt templates into the running agent and re-list the `/` menu. Called
    // after the Library module edits one, so a template becomes invocable without
    // restarting the conversation (chat/agent.ts's reloadPrompts).
    async refreshCommands() {
      if (!b || !id) return;
      await b.chatReloadPrompts({ id });
      commands.set(await b.chatListCommands({ id }));
    },
    async pickModel(value: string) {
      const m = get(models).find((x) => `${x.provider}/${x.id}` === value);
      if (b && m && id) {
        await b.chatSetModel({ id, provider: m.provider, model: m.id });
        // The pick becomes THIS scope's default, not the app's — a workspace that
        // picks a model stops inheriting root's, and every other workspace is
        // unaffected.
        patchScopeChat(scope, {
          defaultProvider: m.provider,
          defaultModel: m.id,
        });
        models.set(await b.chatListModels({ id }));
      }
    },
    pickLevel(value: ThinkingLevel) {
      level.set(value);
      if (id) b?.chatSetThinking({ id, level: value });
      patchScopeChat(scope, { defaultThinkingLevel: value });
    },
    // Put the saved conversation behind us and begin another. The old session file stays
    // on disk; it is simply no longer the most recent one.
    newChat() {
      restart();
    },
    retain() {
      if (refs++ === 0) start();
    },
    release() {
      if (--refs > 0) return;
      // The pane is gone (the view or its workspace closed): stop the agent and drop
      // the session so a future view with the same id starts a fresh one — which then
      // resumes whatever that view last had on disk.
      alive = false;
      if (id) b?.chatStop({ id }).catch(() => {});
      id = undefined;
      ready.set(false);
      sessions.delete(key);
    },
  };
}

const sessions = new Map<string, ChatSession>();

// Re-list the `/` menu of every live conversation. the Library module edits prompt
// templates for a scope, not for one pane, and it holds no chat session of its own —
// so it calls this rather than reaching for a session and accidentally creating one.
export function refreshChatCommands(): void {
  for (const s of sessions.values()) s.refreshCommands().catch(() => {});
}

// The session belonging to one view of one workspace. Both parts key it: the same view
// id exists in every workspace, and a workspace holds several views.
export function chatSession(
  workspaceId?: string,
  viewId?: string,
  cwd?: string,
): ChatSession {
  const key = `${workspaceId ?? ""}/${viewId ?? ""}`;
  let s = sessions.get(key);
  if (!s) {
    s = createSession(key, cwd, workspaceId, viewId);
    sessions.set(key, s);
  }
  return s;
}
