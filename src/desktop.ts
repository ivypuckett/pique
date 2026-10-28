/// <reference lib="deno.desktop" />
// deno-lint-ignore-file prefer-const -- the deps are declared up here for the handlers
// and assigned once below the bindings; see constraint 1.
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

import { handlersFor } from "./lib/modules/handlers.ts";
import { listModules, removeModule } from "./lib/modules/service.ts";

const win = new Deno.BrowserWindow({
  title: "pique",
  width: 1200,
  height: 800,
});

let term: typeof import("./lib/terminal/pty.ts");
let chat: typeof import("./lib/chat/agent.ts");
let providers: typeof import("./lib/chat/providers.ts");
let settings: typeof import("./lib/settings/file.ts");
let dialog: typeof import("./lib/settings/dialog.ts");
let fs: typeof import("./lib/fs.ts");
let git: typeof import("./lib/gitdiff/git.ts");
let extensions: typeof import("./lib/extensions/service.ts");
let prompts: typeof import("./lib/prompts/service.ts");
let skills: typeof import("./lib/skills/service.ts");
let systemPrompts: typeof import("./lib/prompts/system.ts");
let importer: typeof import("./lib/import.ts");
let paths: typeof import("./lib/paths.ts");
// Assigned when the module file server starts, at the very bottom of this file.
let modulesPort = 0;

// A module runs in its workspace's directory, else $HOME.
function moduleDir(override?: string): string {
  return settings.resolveModuleDir(override);
}

// deno desktop has no maximize API — the window options and BrowserWindow expose only
// explicit sizing — so "start maximized" is the frontend measuring its own display and
// calling this once at boot (settings/bindings.ts). Done from there rather than here
// because screen.availWidth/availHeight is the work area, already minus the menu bar,
// dock, and panels, and nothing on this side knows those.
win.bind("windowSetSize", (arg) => {
  const { width, height } = arg as { width: number; height: number };
  win.setSize(width, height);
  return Promise.resolve(true);
});

// Not `async`: there is nothing to await (see moduleManifest below).
win.bind("termStart", (arg) => {
  const { cols, rows, cwd: override, argv } = arg as {
    cols: number;
    rows: number;
    cwd?: string;
    argv?: string[];
  };
  return Promise.resolve({
    id: term.startSession({ cols, rows, cwd: moduleDir(override), argv }),
  });
});

// deno-lint-ignore require-await -- async so an unknown id's throw rejects
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

// deno-lint-ignore require-await -- async so an unknown id's throw rejects
win.bind("termResize", async (arg) => {
  const { id, cols, rows } = arg as { id: string; cols: number; rows: number };
  term.resizeSession(id, cols, rows);
  return true;
});

win.bind("termKill", (arg) => {
  const { id } = arg as { id: string };
  term.killSession(id);
  return Promise.resolve(true);
});

// Where the webview should point a user module's iframe. The port is assigned after the
// awaits below, like `term` and the other late-loaded deps — handlers only run once the
// user opens a module, long after serving starts.
// Not `async`: there is nothing to await, and the lint rule that catches a pointless
// async is worth more than matching the shape of its neighbours.
win.bind("moduleManifest", () => {
  return listModules().then(({ modules }) => ({
    port: modulesPort,
    modules,
  }));
});

win.bind("moduleList", async () => (await listModules()).modules);

win.bind("moduleRemove", async (arg) => {
  const { name } = arg as { name: string };
  await removeModule(name);
  return true;
});

// The one door for everything a user module asks for. `moduleId` comes from the host
// component that mounted the frame (modules/UserModule.svelte), never from the frame
// itself.
win.bind("moduleCall", async (arg) => {
  const { moduleId, method, payload } = arg as {
    moduleId: string;
    method: string;
    payload: unknown;
  };
  const handler = handlersFor(moduleId)[method];
  if (!handler) throw new Error(`${method} is not a module method`);
  return await handler(payload);
});

win.bind("chatStart", async (arg) => {
  const { cwd, workspace, view, fresh } = arg as {
    cwd?: string;
    workspace?: string;
    view?: string;
    fresh?: boolean;
  };
  const id = await chat.startAgent({ cwd, workspace, view, fresh });
  return { id, thinking: chat.thinkingLevelOf(id) };
});

win.bind("chatHistory", (arg) => {
  const { id } = arg as { id: string };
  return Promise.resolve(chat.historyOf(id));
});

// deno-lint-ignore require-await -- async so an unknown id's throw rejects
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

win.bind("chatStop", (arg) => {
  const { id } = arg as { id: string };
  chat.stopAgent(id);
  return Promise.resolve(true);
});

win.bind("chatListModels", async (arg) => {
  const { id } = arg as { id: string };
  return await chat.listModels(id);
});

win.bind("chatListCommands", (arg) => {
  const { id } = arg as { id: string };
  return Promise.resolve(chat.listCommands(id));
});

// Re-read prompt templates from disk into a running agent, so a template saved in the
// Library can be invoked without restarting the conversation.
win.bind("chatReloadPrompts", async (arg) => {
  const { id } = arg as { id: string };
  await chat.reloadPrompts(id);
  return true;
});

// The whole resource set, extensions included — what `/reload` runs. Separate from
// chatReloadPrompts on purpose: that one is automatic after a Library prompt edit,
// this one only ever happens because someone typed the command.
win.bind("chatReload", async (arg) => {
  const { id } = arg as { id: string };
  return await chat.reloadAgent(id);
});

win.bind("chatSetModel", async (arg) => {
  const { id, provider, model } = arg as {
    id: string;
    provider: string;
    model: string;
  };
  await chat.setModel(id, provider, model);
  return true;
});

win.bind("chatSetThinking", (arg) => {
  const { id, level } = arg as { id: string; level: string };
  // deno-lint-ignore no-explicit-any
  chat.setThinkingLevel(id, level as any);
  return Promise.resolve(true);
});

// Model-provider management — connect any provider pi supports (see chat/providers.ts).
// API keys persist to auth.json in the agent dir; custom endpoints to models.json there.
win.bind("providerList", async () => await providers.listProviders());

// Every model the connected providers offer, independent of any chat session — what
// the Settings model checklist offers.
win.bind("providerModels", async () => await providers.listModels());

// A provider's login, one prompt at a time: start returns pi's first prompt, each
// answer the next one, until a step comes back done (see LoginFlow in providers.ts).
win.bind("providerLoginStart", async (arg) => {
  const { id } = arg as { id: string };
  return await providers.loginStart(id);
});

win.bind("providerLoginAnswer", async (arg) => {
  const { value } = arg as { value: string };
  return await providers.loginAnswer(value);
});

win.bind("providerLoginCancel", () => {
  providers.loginCancel();
  return Promise.resolve(true);
});

win.bind("providerSetBedrockRegion", async (arg) => {
  const { region } = arg as { region: string };
  await providers.setBedrockRegion(region);
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

// Named JSON config under ~/.pique/ — settings (prefs), layout (the tree) and chat (the
// chat defaults).
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

win.bind("openExternal", async (arg) => {
  const { url } = arg as { url: string };
  await dialog.openUrl(url);
  return null;
});

win.bind("listDir", async (arg) => {
  const { path } = arg as { path?: string };
  // path undefined → the workspace default; an absolute child path resolves to itself.
  return await fs.listDir(moduleDir(path));
});

// File-tree edits. Same path convention as listDir: a parent of undefined means the
// workspace default, an absolute path resolves to itself. Every failure (bad name, name
// taken, permissions) throws through to the tree's error strip. removeEntry is permanent
// and recursive — the frontend gates it behind a confirmation unless it's turned off.
win.bind("createEntry", async (arg) => {
  const { parent, name } = arg as { parent?: string; name: string };
  return { path: await fs.createEntry(moduleDir(parent), name) };
});

win.bind("renameEntry", async (arg) => {
  const { path, name } = arg as { path: string; name: string };
  return { path: await fs.renameEntry(path, name) };
});

win.bind("removeEntry", async (arg) => {
  const { path } = arg as { path: string };
  await fs.removeEntry(path);
  return true;
});

win.bind("gitDiff", async (arg) => {
  const { cwd: override, staged, path } = arg as {
    cwd?: string;
    staged?: boolean;
    path?: string;
  };
  const depth = settings.resolveGitScanDepth(
    await settings.readJson("settings"),
  );
  return {
    diff: await git.gitDiff(
      moduleDir(override),
      staged ?? false,
      path,
      depth,
    ),
  };
});

win.bind("gitChanges", async (arg) => {
  const { path } = arg as { path?: string };
  const depth = settings.resolveGitScanDepth(
    await settings.readJson("settings"),
  );
  return { changes: await git.changedPaths(moduleDir(path), depth) };
});

// Extensions — one concept covering both origins: loose `.ts` modules in pi's
// extensions dir, and installed pi packages. An extension runs iff it is in pi's own
// loading set (the extensions/ dir, or settings.json).
win.bind("extensionsList", async () => await extensions.listExtensions());

win.bind("extensionsRead", async (arg) => {
  const { id } = arg as { id: string };
  return await extensions.readExtension(id);
});

// Extensions pi could not load, for Library to mark. Builds a loader per call rather
// than caching: the answer is only interesting right after something changed.
win.bind(
  "extensionsLoadErrors",
  async () => await extensions.extensionLoadErrors(),
);

win.bind("extensionsRemove", async (arg) => {
  const { id } = arg as { id: string };
  await extensions.removeExtension(id);
  return true;
});

win.bind("extensionsInstall", async (arg) => {
  const { source } = arg as { source: string };
  await extensions.installPackage(source);
  return true;
});

win.bind("extensionsSearch", async (arg) => {
  const { query, type } = arg as {
    query: string;
    type?: "extension" | "skill" | "prompt" | "theme";
  };
  return await extensions.searchExtensions(query, type);
});

// Prompt templates — reusable messages invoked as `/name` in a Chat module. What a Chat
// module can actually invoke comes from pi via chatListCommands.
win.bind("promptsList", async () => await prompts.listPrompts());

win.bind("promptsSave", async (arg) => {
  const { name, description, argumentHint, body } = arg as {
    name: string;
    description: string;
    argumentHint?: string;
    body: string;
  };
  await prompts.savePrompt(name, { description, argumentHint, body });
  return true;
});

win.bind("promptsDelete", async (arg) => {
  const { name } = arg as { name: string };
  await prompts.deletePrompt(name);
  return true;
});

// Skills — read-only listing; the Library shows this list.
win.bind("skillsList", async () => await skills.listSkills());

// SYSTEM.md and APPEND_SYSTEM.md in pi's agent dir. Unlike every other Library kind
// these are singletons addressed by KIND, not by name. systemPromptsList returns both,
// present or not.
win.bind(
  "systemPromptsList",
  async () => await systemPrompts.listPromptFiles(),
);

// An empty body deletes rather than writes — prompts/system.ts records why, and the
// Library's Save button relabels itself to say so.
win.bind("systemPromptsSave", async (arg) => {
  const { kind, body } = arg as { kind: "system" | "appendix"; body: string };
  await systemPrompts.savePromptFile(kind, body);
  return true;
});

win.bind("systemPromptsDelete", async (arg) => {
  const { kind } = arg as { kind: "system" | "appendix" };
  await systemPrompts.deletePromptFile(kind);
  return true;
});

// The agent dir this process runs against, and pi's own — the setting can differ from
// the first until the next launch, and Settings says so.
win.bind(
  "agentDir",
  () => Promise.resolve({ dir: paths.agentDir(), pi: paths.piAgentDir() }),
);

// Copy the `pi` CLI's setup in (lib/import.ts). It may have replaced auth.json,
// models.json and settings.json, so the runtime and the package manager re-read them.
win.bind("importFromPi", async () => {
  const result = await importer.importFromPi();
  chat.resetRuntime();
  extensions.resetPackageManager();
  return result;
});

// The close button is a quit: pique is a single window, and by the time this returns
// every pty it owned is gone. Exit rather than leaving that to the window —
// on macOS the webview backend can decline to close, and a window that stays up after
// this handler ran is an app whose terminals are all dead and cannot be revived. The
// teardown is guarded for the same reason: a throw from it must not skip the exit.
win.addEventListener("close", () => {
  try {
    term?.killAllSessions();
  } finally {
    Deno.exit(0);
  }
});

// Bindings are attached; now load deps and serve the static Vite build.
// deno desktop auto-navigates the adopted window to the served address.
term = await import("./lib/terminal/pty.ts");
chat = await import("./lib/chat/agent.ts");
providers = await import("./lib/chat/providers.ts");
settings = await import("./lib/settings/file.ts");
dialog = await import("./lib/settings/dialog.ts");
fs = await import("./lib/fs.ts");
git = await import("./lib/gitdiff/git.ts");
extensions = await import("./lib/extensions/service.ts");
prompts = await import("./lib/prompts/service.ts");
skills = await import("./lib/skills/service.ts");
systemPrompts = await import("./lib/prompts/system.ts");
importer = await import("./lib/import.ts");
paths = await import("./lib/paths.ts");
// Where pi's agent dir is, from Settings — before anything is served, so no handler
// runs against the default by mistake. Fixed until the next launch (paths.ts).
paths.configureAgentDir(
  settings.resolveAgentDir(await settings.readJson("settings")),
);
const { serveDir } = await import("@std/http/file-server");
const { fromFileUrl } = await import("@std/path");
// Resolved off this module rather than the cwd: `--include dist` embeds the build one
// level above src/ in the packaged app's virtual filesystem, and the app is started from
// wherever the user happens to be — from Finder, that is `/`. A relative "dist" only ever
// found the real one because `deno task dev` runs from the checkout root.
const fsRoot = fromFileUrl(new URL("../dist", import.meta.url));
// Loopback only: this serves the UI to our own webview, and the default hostname
// (0.0.0.0) would publish it to the LAN for as long as the app is open. The port is
// left alone — deno desktop auto-navigates the adopted window to the served address
// (see the head comment), so it must stay predictable.
Deno.serve(
  { hostname: "127.0.0.1" },
  (req) => serveDir(req, { fsRoot, quiet: true }),
);

// The module file server, deliberately LAST. deno desktop navigates the adopted window
// to the FIRST Deno.serve, so starting this above the frontend's server loads a user
// module's page as the whole app — verified by a spike, and silent when it happens.
// Port 0: this address is handed to the webview at runtime, so unlike the frontend's it
// does not need to be predictable.
{
  const { serveModuleUi } = await import("./lib/modules/server.ts");
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    serveModuleUi,
  );
  modulesPort = (server.addr as Deno.NetAddr).port;
}
