// Does enabling an extension reach a chat session that is ALREADY running?
//
// Everything in docs/ says no — enable takes effect in Chat modules opened afterwards —
// and the recorded plan for fixing it routes a `/reload` command through
// pi.sendUserMessage, on the assumption that reload is a TUI-mode affair. It is not:
// AgentSession exposes reload() directly, and reload() rebuilds the extension runner
// from a re-read resource loader (agent-session.js `_buildRuntime`), passing
// includeAllExtensionTools so freshly registered tools land in the ACTIVE set rather
// than merely the registry.
//
// The three claims that has to satisfy before pique can lean on it are below: an
// enable lands, a revoke lands, and the conversation is not thrown away in the process.
// The scaffolding (mock model endpoint, seeded models.json, temp HOME) is the shape
// automatons/run_integration_test.ts established, for the same reason: startAgent
// resolves a real model and refuses to start without one.
import { assertEquals } from "@std/assert";
import {
  activeToolNames,
  historyOf,
  listCommands,
  listModels,
  promptAgent,
  readAgent,
  reloadAgent,
  startAgent,
  stopAgent,
} from "./agent.ts";
import { enableLocal, revokeLocal } from "../extensions/local.ts";
import { ensureExtensionDirs, pendingPath } from "../extensions/paths.ts";
import { writeScopeConfig } from "../scope/config.ts";
import type { ScopeId } from "../scope/paths.ts";

const SCOPE: ScopeId = "ws-1";
const REPLY = "reload-reply-ok";

// One mock model endpoint for the file: chat/agent.ts's ModelRuntime is a process-wide
// singleton created on first use and never re-reads models.json, so the baseUrl seeded
// by the first test is the one every later test gets.
function sse(): string {
  const chunk = (choice: unknown) =>
    `data: ${
      JSON.stringify({
        id: "mock-completion",
        object: "chat.completion.chunk",
        created: 0,
        model: "mock-model",
        choices: [choice],
      })
    }\n\n`;
  return chunk({ index: 0, delta: { role: "assistant", content: REPLY } }) +
    chunk({ index: 0, delta: {}, finish_reason: "stop" }) +
    "data: [DONE]\n\n";
}

// The last request body the model endpoint saw, so a test can assert what actually
// reached the model rather than only what came back.
let lastRequest = "";

const server = Deno.serve(
  { port: 0, onListen: () => {} },
  async (req) => {
    lastRequest = await req.text();
    return new Response(sse(), {
      headers: { "content-type": "text/event-stream" },
    });
  },
);
server.unref();
const baseUrl = `http://localhost:${(server.addr as Deno.NetAddr).port}/v1`;

async function withTempHome(fn: (cwd: string) => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  const cwd = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await Deno.mkdir(`${dir}/.pi/agent`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.pi/agent/models.json`,
      JSON.stringify({
        providers: {
          mock: {
            baseUrl,
            api: "openai-completions",
            apiKey: "mock",
            // Two, so a test can move the scope's default to a model that is genuinely
            // available — the case reload reports on.
            models: [{
              id: "mock-model",
              contextWindow: 128000,
              input: ["text"],
            }, {
              id: "mock-model-2",
              contextWindow: 128000,
              input: ["text"],
            }],
          },
        },
      }),
    );
    await writeScopeConfig(SCOPE, {
      chat: { defaultProvider: "mock", defaultModel: "mock-model" },
    });
    await fn(cwd);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(cwd, { recursive: true });
  }
}

// A real pi extension module, the shape define_extension writes and a human approves.
function extensionSource(name: string): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: ${JSON.stringify(name)},
    label: ${JSON.stringify(name)},
    description: "reload fixture",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: null };
    },
  });
}
`;
}

async function defineAndApprove(scope: ScopeId, name: string): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, name), extensionSource(name));
  await enableLocal(scope, name);
}

Deno.test("an extension enabled AFTER the session started becomes callable on reload", async () => {
  await withTempHome(async () => {
    const chat = await startAgent({ scope: SCOPE });
    try {
      assertEquals(
        activeToolNames(chat).includes("late_tool"),
        false,
        "precondition: the tool must not be there before it is enabled",
      );

      await defineAndApprove(SCOPE, "late_tool");
      await reloadAgent(chat);

      assertEquals(
        activeToolNames(chat).includes("late_tool"),
        true,
        "the enabled extension must reach the RUNNING session",
      );
    } finally {
      stopAgent(chat);
    }
  });
});

Deno.test("a revoked extension's tool is gone from the running session on reload", async () => {
  await withTempHome(async () => {
    await defineAndApprove(SCOPE, "doomed_tool");
    const chat = await startAgent({ scope: SCOPE });
    try {
      assertEquals(
        activeToolNames(chat).includes("doomed_tool"),
        true,
        "precondition: an enabled extension loads at startup",
      );

      await revokeLocal(SCOPE, "doomed_tool");
      await reloadAgent(chat);

      // Reload carries the previous active set forward, so a revoked tool's name could
      // plausibly linger in it; it does not — the rebuilt registry is what the active
      // list is filtered against.
      assertEquals(
        activeToolNames(chat).includes("doomed_tool"),
        false,
        "a revoked extension must stop being callable",
      );
    } finally {
      stopAgent(chat);
    }
  });
});

Deno.test("the conversation survives a reload", async () => {
  await withTempHome(async () => {
    const chat = await startAgent({ scope: SCOPE });
    try {
      promptAgent(chat, "hello");
      // Drain until the turn reports done, so there is a real transcript to preserve.
      let done = false;
      const deadline = Date.now() + 15_000;
      while (!done && Date.now() < deadline) {
        for (const event of await readAgent(chat)) {
          if (event.kind === "done" || event.kind === "error") done = true;
        }
      }
      assertEquals(done, true, "the fixture turn must complete");
      const before = historyOf(chat);
      assertEquals(
        before.length > 0,
        true,
        "precondition: a transcript exists",
      );

      await reloadAgent(chat);

      assertEquals(
        historyOf(chat).length,
        before.length,
        "reload must not drop the conversation",
      );
    } finally {
      stopAgent(chat);
    }
  });
});

// The scope's model default is resolved in startAgent, and a reload deliberately does not
// re-apply it — a conversation keeps the model it has been running. Saying nothing about
// it was the problem: someone who changes the default in another view and reloads here
// would otherwise be told only "no tool changes".
Deno.test("a model default changed elsewhere is reported, never applied", async () => {
  await withTempHome(async () => {
    const chat = await startAgent({ scope: SCOPE });
    try {
      await writeScopeConfig(SCOPE, {
        chat: { defaultProvider: "mock", defaultModel: "mock-model-2" },
      });

      const summary = await reloadAgent(chat);

      assertEquals(summary.modelDefault, {
        provider: "mock",
        id: "mock-model-2",
      });
      assertEquals(
        (await listModels(chat)).find((m) => m.current)?.id,
        "mock-model",
        "the running conversation keeps its model",
      );
    } finally {
      stopAgent(chat);
    }
  });
});

Deno.test("a reload reports no model default when the scope's is what runs", async () => {
  await withTempHome(async () => {
    const chat = await startAgent({ scope: SCOPE });
    try {
      assertEquals((await reloadAgent(chat)).modelDefault, undefined);
    } finally {
      stopAgent(chat);
    }
  });
});

// ---------------------------------------------------------------------------
// The two claims `/reload` as a COMMAND rests on. The store intercepts the text before
// it reaches the backend (store_test.ts); these cover why it has to, and that the
// command is discoverable in the `/` menu once it does.
// ---------------------------------------------------------------------------

Deno.test("pi does not expand /reload — it reaches the model as literal text", async () => {
  await withTempHome(async () => {
    const chat = await startAgent({ scope: SCOPE });
    try {
      lastRequest = "";
      promptAgent(chat, "/reload");
      let done = false;
      const deadline = Date.now() + 15_000;
      while (!done && Date.now() < deadline) {
        for (const event of await readAgent(chat)) {
          if (event.kind === "done" || event.kind === "error") done = true;
        }
      }
      assertEquals(done, true, "the turn must complete");

      // pi's builtins are TUI actions; session.prompt() does not run them. So a chat
      // that simply forwarded "/reload" would be asking the model about the word —
      // which is exactly what this asserts, and why the store intercepts it instead.
      const users = JSON.parse(lastRequest).messages
        .filter((m: { role: string }) => m.role === "user");
      assertEquals(
        JSON.stringify(users).includes("/reload"),
        true,
        "the raw command text is what the model would receive",
      );
    } finally {
      stopAgent(chat);
    }
  });
});

Deno.test("the / menu offers pique's own /reload", async () => {
  await withTempHome(async () => {
    const chat = await startAgent({ scope: SCOPE });
    try {
      const reload = listCommands(chat).find((c) => c.name === "reload");
      assertEquals(
        reload?.source,
        "pique",
        "listed, and marked as pique's own",
      );
      assertEquals(
        typeof reload?.description,
        "string",
        "the menu renders a description beside it",
      );
    } finally {
      stopAgent(chat);
    }
  });
});
