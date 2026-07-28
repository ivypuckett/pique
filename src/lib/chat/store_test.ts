// The chat session store, driven against a fake backend. What is worth testing here is
// the restart that switching profile forces: pi fixes the system prompt at session
// creation, so pickProfile stops one agent and starts another, and the events of the
// old one must not land in the new transcript.
import { assertEquals } from "@std/assert";
import { get } from "svelte/store";
import type { ChatEvent } from "./bindings.ts";
import { chatSession } from "./store.ts";

// A backend that hands out incrementing agent ids and lets a test push events to a
// chosen agent, so "the old agent answered late" is expressible.
function fakeBindings() {
  const started: { id: string; profile?: string }[] = [];
  const stopped: string[] = [];
  const queues = new Map<string, ChatEvent[]>();
  let next = 1;
  const bindings = {
    // deno-lint-ignore no-explicit-any
    chatStart(arg: any) {
      const id = `agent-${next++}`;
      started.push({ id, profile: arg.profile });
      queues.set(id, []);
      return Promise.resolve({ id });
    },
    // deno-lint-ignore no-explicit-any
    chatStop(arg: any) {
      stopped.push(arg.id);
      return Promise.resolve(true);
    },
    // deno-lint-ignore no-explicit-any
    async chatRead(arg: any): Promise<ChatEvent[]> {
      // Park until this agent has something, mirroring the real long-poll.
      for (let i = 0; i < 200; i++) {
        const q = queues.get(arg.id) ?? [];
        if (q.length) return q.splice(0, q.length);
        await new Promise((r) => setTimeout(r, 1));
      }
      return [];
    },
    chatPrompt: () => Promise.resolve(true),
    chatAbort: () => Promise.resolve(true),
    chatListModels: () => Promise.resolve([]),
    chatListCommands: () => Promise.resolve([]),
    chatSetModel: () => Promise.resolve(true),
    chatSetThinking: () => Promise.resolve(true),
    profilesVisible: () => Promise.resolve([]),
    profilesList: () => Promise.resolve([]),
    scopeConfigRead: () => Promise.resolve({}),
    scopeConfigWrite: () => Promise.resolve(true),
    scopeConfigResolve: () => Promise.resolve({}),
  };
  return {
    bindings,
    started,
    stopped,
    emit(id: string, ev: ChatEvent) {
      queues.get(id)?.push(ev);
    },
  };
}

async function withFakeBackend(fn: (f: ReturnType<typeof fakeBindings>) => Promise<void>) {
  const f = fakeBindings();
  const g = globalThis as unknown as { bindings?: unknown };
  const prev = g.bindings;
  g.bindings = f.bindings;
  try {
    await fn(f);
  } finally {
    if (prev === undefined) delete g.bindings;
    else g.bindings = prev;
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

Deno.test("picking a profile restarts the agent and clears the transcript", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-restart-1");
    s.retain();
    await settle();

    f.emit("agent-1", { kind: "text", delta: "from the first agent" });
    await settle();
    assertEquals(get(s.items).length, 1);

    s.pickProfile("reviewer");
    await settle();

    assertEquals(get(s.items), [], "the transcript belongs to the agent that produced it");
    assertEquals(f.stopped, ["agent-1"], "the old agent is stopped, not leaked");
    assertEquals(f.started.map((x) => x.profile), [undefined, "reviewer"]);
    assertEquals(get(s.profile), "reviewer");

    s.release();
  });
});

Deno.test("a late reply from the old agent cannot land in the new transcript", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-restart-2");
    s.retain();
    await settle();

    // The restart happens while agent-1's read is still parked — the exact window a
    // plain `alive` flag would reopen, because start() sets it back to true.
    s.pickProfile("reviewer");
    f.emit("agent-1", { kind: "text", delta: "stale answer" });
    await settle();

    assertEquals(get(s.items), [], "the old agent's event must be dropped");

    f.emit("agent-2", { kind: "text", delta: "fresh answer" });
    await settle();
    assertEquals(get(s.items), [{ role: "assistant", text: "fresh answer" }]);

    s.release();
  });
});

Deno.test("picking the profile already in use does nothing", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-restart-3");
    s.retain();
    await settle();

    f.emit("agent-1", { kind: "text", delta: "kept" });
    await settle();

    s.pickProfile("");
    await settle();

    assertEquals(f.started.length, 1, "no needless restart");
    assertEquals(get(s.items).length, 1, "and no needless transcript loss");

    s.release();
  });
});

Deno.test("release stops the agent and drops the session", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-restart-4");
    s.retain();
    await settle();
    s.release();
    await settle();

    assertEquals(f.stopped, ["agent-1"]);
    // A fresh session for the same workspace starts a new agent rather than reusing one.
    chatSession("ws-restart-4").retain();
    await settle();
    assertEquals(f.started.length, 2);
    chatSession("ws-restart-4").release();
  });
});
