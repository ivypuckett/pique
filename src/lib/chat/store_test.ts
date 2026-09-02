// The chat session store, driven against a fake backend. What is worth testing here is
// the restart a new chat forces: the session file cannot be swapped on a running pi
// session, so newChat stops one agent and starts another, and the events of the old one
// must not land in the new transcript.
import { assertEquals } from "@std/assert";
import { get } from "svelte/store";
import type { ChatEvent, Item, ReloadSummary } from "./bindings.ts";
import { chatSession, formatReloadNotice } from "./store.ts";

// A backend that hands out incrementing agent ids and lets a test push events to a
// chosen agent, so "the old agent answered late" is expressible. `resumed` stands in for
// the saved conversation the real backend hands back: agents started with fresh:true get
// none, matching SessionManager.create vs continueRecent.
function fakeBindings(resumed: Item[] = []) {
  const started: {
    id: string;
    scope?: string;
    view?: string;
    fresh?: boolean;
  }[] = [];
  const stopped: string[] = [];
  const queues = new Map<string, ChatEvent[]>();
  const histories = new Map<string, Item[]>();
  // What actually reached the model, so a test can assert that `/reload` did NOT.
  const prompted: string[] = [];
  let next = 1;
  let reloads = 0;
  let listedCommands = 0;
  let reloadSummary: ReloadSummary = { added: [], removed: [], failed: [] };
  const bindings = {
    // deno-lint-ignore no-explicit-any
    chatStart(arg: any) {
      const id = `agent-${next++}`;
      started.push({ id, scope: arg.scope, view: arg.view, fresh: arg.fresh });
      queues.set(id, []);
      histories.set(id, arg.fresh ? [] : resumed);
      return Promise.resolve({ id });
    },
    // deno-lint-ignore no-explicit-any
    chatHistory(arg: any) {
      return Promise.resolve(histories.get(arg.id) ?? []);
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
    // deno-lint-ignore no-explicit-any
    chatPrompt(arg: any) {
      prompted.push(arg.text);
      return Promise.resolve(true);
    },
    chatAbort: () => Promise.resolve(true),
    chatListModels: () => Promise.resolve([]),
    chatListCommands: () => {
      listedCommands++;
      return Promise.resolve([]);
    },
    chatReload: () => {
      reloads++;
      return Promise.resolve(reloadSummary);
    },
    chatSetModel: () => Promise.resolve(true),
    chatSetThinking: () => Promise.resolve(true),
    scopeConfigRead: () => Promise.resolve({}),
    scopeConfigWrite: () => Promise.resolve(true),
    scopeConfigResolve: () => Promise.resolve({}),
  };
  return {
    bindings,
    started,
    stopped,
    prompted,
    emit(id: string, ev: ChatEvent) {
      queues.get(id)?.push(ev);
    },
    reloadCount: () => reloads,
    listedCommandsCount: () => listedCommands,
    setReloadSummary(s: ReloadSummary) {
      reloadSummary = s;
    },
  };
}

async function withFakeBackend(
  fn: (f: ReturnType<typeof fakeBindings>) => Promise<void>,
  resumed: Item[] = [],
) {
  const f = fakeBindings(resumed);
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

const SAVED: Item[] = [
  { role: "user", text: "before the restart" },
  { role: "assistant", text: "still here" },
];

Deno.test("a started session shows the conversation the backend resumed", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-resume-1", "view-1");
    s.retain();
    await settle();

    assertEquals(get(s.items), SAVED, "reopening picks the transcript back up");
    assertEquals(
      f.started[0].fresh,
      undefined,
      "the first start resumes rather than resets",
    );

    // And the resumed transcript is what new events build on, not a separate one.
    f.emit("agent-1", { kind: "text", delta: " and continuing" });
    await settle();
    assertEquals(get(s.items), [
      { role: "user", text: "before the restart" },
      { role: "assistant", text: "still here and continuing" },
    ]);

    s.release();
  }, SAVED);
});

Deno.test("a new chat starts fresh and drops the resumed transcript", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-resume-2", "view-1");
    s.retain();
    await settle();
    assertEquals(get(s.items), SAVED);

    s.newChat();
    await settle();

    assertEquals(get(s.items), [], "a new chat is an empty one");
    assertEquals(
      f.stopped,
      ["agent-1"],
      "the old agent is stopped, not leaked",
    );
    assertEquals(f.started.map((x) => x.fresh), [undefined, true]);

    s.release();
  }, SAVED);
});

Deno.test("a new chat drops the transcript the old agent streamed", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-restart-1", "view-1");
    s.retain();
    await settle();

    f.emit("agent-1", { kind: "text", delta: "from the first agent" });
    await settle();
    assertEquals(get(s.items).length, 1);

    s.newChat();
    await settle();

    assertEquals(
      get(s.items),
      [],
      "the transcript belongs to the agent that produced it",
    );
    assertEquals(
      f.stopped,
      ["agent-1"],
      "the old agent is stopped, not leaked",
    );
    assertEquals(
      f.started[1].fresh,
      true,
      "a new chat gets a new conversation, not the saved one",
    );

    s.release();
  });
});

Deno.test("a late reply from the old agent cannot land in the new transcript", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-restart-2", "view-1");
    s.retain();
    await settle();

    // The restart happens while agent-1's read is still parked — the exact window a
    // plain `alive` flag would reopen, because start() sets it back to true.
    s.newChat();
    f.emit("agent-1", { kind: "text", delta: "stale answer" });
    await settle();

    assertEquals(get(s.items), [], "the old agent's event must be dropped");

    f.emit("agent-2", { kind: "text", delta: "fresh answer" });
    await settle();
    assertEquals(get(s.items), [{ role: "assistant", text: "fresh answer" }]);

    s.release();
  });
});

Deno.test("release stops the agent and drops the session", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-restart-4", "view-1");
    s.retain();
    await settle();
    s.release();
    await settle();

    assertEquals(f.stopped, ["agent-1"]);
    // A fresh session for the same view starts a new agent rather than reusing one.
    chatSession("ws-restart-4", "view-1").retain();
    await settle();
    assertEquals(f.started.length, 2);
    chatSession("ws-restart-4", "view-1").release();
  });
});

// ---------------------------------------------------------------------------
// One conversation per VIEW, not per workspace. Two views of one workspace are two
// contexts; the backend keeps them apart by view (chat/agent.ts's sessionDir), so the
// view id has to reach it and the two panes must not share a store.
// ---------------------------------------------------------------------------

Deno.test("two views of one workspace hold separate conversations", async () => {
  await withFakeBackend(async (f) => {
    const left = chatSession("ws-views", "view-1");
    const right = chatSession("ws-views", "view-2");
    left.retain();
    right.retain();
    await settle();

    assertEquals(
      f.started.map((x) => [x.scope, x.view]),
      [["ws-views", "view-1"], ["ws-views", "view-2"]],
      "each view starts its own agent, in the same scope",
    );

    f.emit("agent-1", { kind: "text", delta: " — left only" });
    await settle();
    assertEquals(get(left.items).at(-1), {
      role: "assistant",
      text: "still here — left only",
    });
    assertEquals(
      get(right.items),
      SAVED,
      "one view's reply must not appear in the other",
    );

    // Nor is the compose state shared — the input is per view like the transcript.
    left.input.set("half a thought");
    assertEquals(get(right.input), "");

    // Closing one view stops only its agent.
    left.release();
    await settle();
    assertEquals(f.stopped, ["agent-1"]);

    right.release();
  }, SAVED);
});

// ---------------------------------------------------------------------------
// `/new` (and its `/clear` alias): pique's own command, the way a new chat is started
// now that there is no button. Same reason as `/reload` for intercepting it — pi would
// send the literal text to the model.
// ---------------------------------------------------------------------------

for (const cmd of ["/new", "/clear"]) {
  Deno.test(`${cmd} starts a new chat instead of prompting the model`, async () => {
    await withFakeBackend(async (f) => {
      const s = chatSession(`ws-new-${cmd.slice(1)}`, "view-1");
      s.retain();
      await settle();
      assertEquals(get(s.items), SAVED);

      s.input.set(cmd);
      s.send();
      await settle();

      assertEquals(f.prompted, [], `the model must not be asked about ${cmd}`);
      assertEquals(get(s.items), [], "the new chat is an empty one");
      assertEquals(f.stopped, ["agent-1"], "the old agent is stopped");
      assertEquals(f.started.map((x) => x.fresh), [undefined, true]);
      assertEquals(get(s.input), "", "the input is cleared like any other send");

      s.release();
    }, SAVED);
  });
}

// ---------------------------------------------------------------------------
// `/reload`: pique's own command. The point of intercepting it in the store is that pi
// does NOT expand it — session.prompt("/reload") sends the literal text to the model
// (verified against a real session) — so "never reaches chatPrompt" is the claim.
// ---------------------------------------------------------------------------

Deno.test("/reload is handled by pique and never sent to the model", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-reload-1", "view-1");
    s.retain();
    await settle();
    f.setReloadSummary({ added: ["new_tool"], removed: [], failed: [] });

    s.input.set("/reload");
    s.send();
    await settle();

    assertEquals(f.prompted, [], "the model must not be asked about /reload");
    assertEquals(f.reloadCount(), 1, "the reload must actually run");
    assertEquals(
      get(s.items),
      [
        ...SAVED,
        { role: "user", text: "/reload" },
        { role: "notice", text: "Reloaded — +new_tool" },
      ],
      "the transcript shows the command and what it did",
    );
    assertEquals(
      get(s.streaming),
      false,
      "there is no model turn, so the input must stay usable",
    );
    assertEquals(get(s.input), "", "the input is cleared like any other send");

    s.release();
  }, SAVED);
});

Deno.test("/reload re-lists the command menu, since an extension can add commands", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-reload-2", "view-1");
    s.retain();
    await settle();
    const before = f.listedCommandsCount();

    s.input.set("/reload");
    s.send();
    await settle();

    assertEquals(
      f.listedCommandsCount(),
      before + 1,
      "the `/` menu must be re-read after a reload",
    );
    s.release();
  });
});

Deno.test("ordinary text is still sent to the model", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-reload-3", "view-1");
    s.retain();
    await settle();

    s.input.set("what does /reload do?");
    s.send();
    await settle();

    assertEquals(f.prompted, ["what does /reload do?"]);
    assertEquals(f.reloadCount(), 0, "only the exact command reloads");
    s.release();
  });
});

// What run_subagent's progress rides on: a tool that reports partial results while it
// is still running. The call must stay open, or the transcript would show a delegation
// as finished at its first line of progress.
Deno.test("a tool update shows partial output while the call is still running", async () => {
  await withFakeBackend(async (f) => {
    const s = chatSession("ws-tool-update", "view-1");
    s.retain();
    await settle();

    f.emit("agent-1", {
      kind: "tool_start",
      id: "c1",
      name: "run_subagent",
      args: '{"agent":"scout"}',
    });
    f.emit("agent-1", { kind: "tool_update", id: "c1", result: "ls {}" });
    f.emit("agent-1", {
      kind: "tool_update",
      id: "c1",
      result: 'ls {}\nread {"file":"a.ts"}',
    });
    await settle();

    assertEquals(get(s.items), [{
      role: "tool",
      id: "c1",
      name: "run_subagent",
      args: '{"agent":"scout"}',
      result: 'ls {}\nread {"file":"a.ts"}',
      isError: false,
      done: false,
    }], "each update replaces the last, and the call is not done yet");

    f.emit("agent-1", {
      kind: "tool_end",
      id: "c1",
      name: "run_subagent",
      result: "the scout's answer",
      isError: false,
    });
    await settle();

    const done = get(s.items)[0];
    assertEquals(done.role === "tool" && done.result, "the scout's answer");
    assertEquals(done.role === "tool" && done.done, true);

    s.release();
  });
});

Deno.test("formatReloadNotice names failures first, then the tool changes", () => {
  assertEquals(
    formatReloadNotice({ added: [], removed: [], failed: [] }),
    "Reloaded — no tool changes",
    "a no-op reload still says something, or it looks like nothing happened",
  );
  assertEquals(
    formatReloadNotice({ added: ["a", "b"], removed: ["c"], failed: [] }),
    "Reloaded — +a +b; −c",
  );
  assertEquals(
    formatReloadNotice({
      added: [],
      removed: [],
      failed: [{ name: "broken", error: "Expected ')'\n  at line 1" }],
    }),
    "Reloaded — ⚠ broken failed to load: Expected ')'; no tool changes",
    "only the first line of the error, and the failure comes first",
  );
});

// The two things a reload does that are NOT tool changes. Saying "no tool changes" and
// stopping is what made a `/reload` after editing SYSTEM.md look like a no-op, when the
// edit had in fact been applied.
Deno.test("formatReloadNotice reports the system prompt and the scope's model", () => {
  assertEquals(
    formatReloadNotice({
      added: [],
      removed: [],
      failed: [],
      promptChanged: true,
    }),
    "Reloaded — no tool changes; system prompt updated",
    "an applied SYSTEM.md edit has to be visible, or the reload reads as a no-op",
  );
  assertEquals(
    formatReloadNotice({
      added: ["t"],
      removed: [],
      failed: [],
      modelDefault: { provider: "anthropic", id: "claude-opus-5" },
    }),
    "Reloaded — +t; model default is now anthropic/claude-opus-5 — new chat to use it",
    "the model is reported, not applied: this conversation keeps the model it has",
  );
});
