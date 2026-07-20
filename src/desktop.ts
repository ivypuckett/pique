/// <reference lib="deno.desktop" />
// deno desktop backend entry.
//
// Two hard-won constraints (both verified end-to-end, both silent when violated):
//
// 1. The window must be created, and ALL win.bind handlers registered, BEFORE any
//    top-level `await`. deno desktop auto-navigates the adopted startup window as soon
//    as the event loop yields; if a binding isn't attached by then, calls to it fail
//    with "No callback bound" and the frontend silently degrades. So we bind first,
//    referencing `term` (assigned after the awaits — handlers only run once the user
//    interacts, long after `term` is populated), then load deps and serve.
// 2. Binding values must be JSON — a `Uint8Array` return throws "invalid type: byte
//    array". PTY output is therefore sent as a plain number array and rebuilt into a
//    Uint8Array on the frontend.

const win = new Deno.BrowserWindow({ title: "pique", width: 1200, height: 800 });

let term: typeof import("./lib/terminal/pty.ts");
let chat: typeof import("./lib/chat/agent.ts");
let providers: typeof import("./lib/chat/providers.ts");
let extensions: typeof import("./lib/chat/extensions.ts");
let settings: typeof import("./lib/settings/file.ts");
let dialog: typeof import("./lib/settings/dialog.ts");
let fs: typeof import("./lib/fs.ts");

win.bind("termStart", async (arg) => {
  const { cols, rows, cwd: override, argv } = arg as {
    cols: number;
    rows: number;
    cwd?: string;
    argv?: string[];
  };
  const cwd = settings.resolveModuleDir(override, await settings.readJson("settings"));
  return { id: term.startSession({ cols, rows, cwd, argv }) };
});

win.bind("termWrite", async (arg) => {
  const { id, data } = arg as { id: string; data: string };
  term.writeSession(id, data);
  return true;
});

// Long-poll: resolve as soon as bytes arrive or the shell exits; otherwise return
// empty after 20s so the frontend re-issues the read (bounded, backpressured).
// `data` is a number array (JSON-safe); the frontend rebuilds a Uint8Array.
win.bind("termRead", async (arg) => {
  const { id } = arg as { id: string };
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { data, done } = term.readSession(id);
    if (done) return { data: [] as number[], done: true };
    if (data.length) return { data: Array.from(data), done: false };
    await new Promise((r) => setTimeout(r, 15));
  }
  return { data: [] as number[], done: false };
});

win.bind("termResize", async (arg) => {
  const { id, cols, rows } = arg as { id: string; cols: number; rows: number };
  term.resizeSession(id, cols, rows);
  return true;
});

win.bind("termKill", async (arg) => {
  const { id } = arg as { id: string };
  term.killSession(id);
  return true;
});

win.bind("chatStart", async (arg) => {
  const { cwd } = arg as { cwd?: string };
  return { id: await chat.startAgent({ cwd }) };
});

win.bind("chatPrompt", async (arg) => {
  const { id, text } = arg as { id: string; text: string };
  chat.promptAgent(id, text);
  return true;
});

win.bind("chatRead", async (arg) => {
  const { id } = arg as { id: string };
  return await chat.readAgent(id);
});

win.bind("chatAbort", async (arg) => {
  const { id } = arg as { id: string };
  await chat.abortAgent(id);
  return true;
});

win.bind("chatStop", async (arg) => {
  const { id } = arg as { id: string };
  chat.stopAgent(id);
  return true;
});

win.bind("chatListModels", async (arg) => {
  const { id } = arg as { id: string };
  return await chat.listModels(id);
});

win.bind("chatListCommands", async (arg) => {
  const { id } = arg as { id: string };
  return chat.listCommands(id);
});

win.bind("chatSetModel", async (arg) => {
  const { id, provider, model } = arg as { id: string; provider: string; model: string };
  await chat.setModel(id, provider, model);
  return true;
});

win.bind("chatSetThinking", async (arg) => {
  const { id, level } = arg as { id: string; level: string };
  // deno-lint-ignore no-explicit-any
  chat.setThinkingLevel(id, level as any);
  return true;
});

// Model-provider management — connect any provider pi supports (see chat/providers.ts).
// API keys persist to ~/.pi/agent/auth.json; custom endpoints to ~/.pi/agent/models.json.
win.bind("providerList", async () => await providers.listProviders());

win.bind("providerConnect", async (arg) => {
  const { id, apiKey } = arg as { id: string; apiKey: string };
  await providers.connectProvider(id, apiKey);
  return true;
});

win.bind("providerDisconnect", async (arg) => {
  const { id } = arg as { id: string };
  await providers.disconnectProvider(id);
  return true;
});

win.bind("providerAddCustom", async (arg) => {
  const { id, baseUrl, apiKey, models } = arg as {
    id: string;
    baseUrl: string;
    apiKey?: string;
    models: string[];
  };
  await providers.addCustomProvider({ id, baseUrl, apiKey, models });
  return true;
});

win.bind("providerRemoveCustom", async (arg) => {
  const { id } = arg as { id: string };
  await providers.removeCustomProvider(id);
  return true;
});

// Pi-extension management — global per-install set under ~/.pique/agent. installExtension
// fetches from npm/git and writes settings.json; the frontend gates it behind a confirm.
win.bind("extList", async () => await extensions.listExtensions());

win.bind("extSearch", async (arg) => {
  const { query } = arg as { query: string };
  return await extensions.searchExtensions(query);
});

win.bind("extInstall", async (arg) => {
  const { source } = arg as { source: string };
  await extensions.installExtension(source);
  return true;
});

win.bind("extRemove", async (arg) => {
  const { source } = arg as { source: string };
  await extensions.removeExtension(source);
  return true;
});

// Named JSON config under ~/.pique/ — settings (prefs) and layout (the tree).
win.bind("configRead", async (arg) => {
  const { name } = arg as { name: string };
  // Stored value is JSON we wrote; the frontend re-types it (settings/bindings.ts).
  return await settings.readJson(name);
});

win.bind("configWrite", async (arg) => {
  const { name, data } = arg as { name: string; data: unknown };
  await settings.writeJson(name, data);
  return true;
});

win.bind("pickDirectory", async (arg) => {
  const { startDir } = arg as { startDir?: string };
  const start = startDir && startDir.trim() !== ""
    ? startDir
    : settings.resolveWorkspaceDir(await settings.readJson("settings"));
  const path = await dialog.pickDirectory(start);
  return path ? { path } : null;
});

win.bind("listDir", async (arg) => {
  const { path } = arg as { path?: string };
  // path undefined → the workspace default; an absolute child path resolves to itself.
  const dir = settings.resolveModuleDir(path, await settings.readJson("settings"));
  return await fs.listDir(dir);
});

win.addEventListener("close", () => term?.killAllSessions());

// Bindings are attached; now load deps and serve the static Vite build.
// deno desktop auto-navigates the adopted window to the served address.
term = await import("./lib/terminal/pty.ts");
chat = await import("./lib/chat/agent.ts");
providers = await import("./lib/chat/providers.ts");
extensions = await import("./lib/chat/extensions.ts");
settings = await import("./lib/settings/file.ts");
dialog = await import("./lib/settings/dialog.ts");
fs = await import("./lib/fs.ts");
const { serveDir } = await import("jsr:@std/http@^1/file-server");
Deno.serve((req) => serveDir(req, { fsRoot: "dist", quiet: true }));
