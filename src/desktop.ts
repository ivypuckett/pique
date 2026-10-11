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

import { dispatch } from "./lib/modules/broker.ts";
import { handlersFor } from "./lib/modules/handlers.ts";
import {
  enableModule,
  listAllModules,
  listModules,
  listPendingModules,
  manifestFor,
  revokeModule,
} from "./lib/modules/service.ts";

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
let scopeConfig: typeof import("./lib/scope/config.ts");
let scopePrompt: typeof import("./lib/scope/prompt.ts");
// Assigned when the module file server starts, at the very bottom of this file.
let modulesPort = 0;

// A module with no cwd of its own inherits the root workspace's, which lives in the
// layout tree — so working-directory resolution reads "layout", not "settings".
async function moduleDir(override?: string): Promise<string> {
  return settings.resolveModuleDir(override, await settings.readJson("layout"));
}

// deno desktop has no maximize API — the window options and BrowserWindow expose only
// explicit sizing — so "start maximized" is the frontend measuring its own display and
// calling this once at boot (settings/bindings.ts). Done from there rather than here
// because screen.availWidth/availHeight is the work area, already minus the menu bar,
// dock, and panels, and nothing on this side knows those.
win.bind("windowSetSize", async (arg) => {
  const { width, height } = arg as { width: number; height: number };
  win.setSize(width, height);
  return true;
});

win.bind("termStart", async (arg) => {
  const { cols, rows, cwd: override, argv } = arg as {
    cols: number;
    rows: number;
    cwd?: string;
    argv?: string[];
  };
  return {
    id: term.startSession({ cols, rows, cwd: await moduleDir(override), argv }),
  };
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

// Where the webview should point a user module's iframe. The port is assigned after the
// awaits below, like `term` and the other late-loaded deps — handlers only run once the
// user opens a module, long after serving starts.
// Not `async`: there is nothing to await, and the lint rule that catches a pointless
// async is worth more than matching the shape of its neighbours.
win.bind("moduleManifest", () => {
  // Every scope's modules in one list: the rail is per-window, not per-scope, and a
  // module carries the scope that owns it so the frame can be addressed there.
  return listAllModules().then((defs) => ({
    port: modulesPort,
    modules: defs,
  }));
});

// The one door for everything a user module asks for. `moduleId` and `scope` come from
// the host component that mounted the frame (modules/UserModule.svelte), never from the
// frame itself — a frame cannot name a module, so it cannot name another one. The
// manifest is then resolved from disk for THAT module, and the broker refuses anything
// it does not grant before a handler runs.
win.bind("moduleList", async (arg) => {
  const { scope } = arg as { scope: string };
  const [own, pending] = await Promise.all([
    listModules(scope),
    listPendingModules(scope),
  ]);
  // What the scope inherits: root's modules are visible from every workspace, and are
  // consented to and revoked in root, never here.
  const inherited = scope === "root" ? [] : (await listModules("root")).modules;
  return { installed: [...own.modules, ...inherited], pending };
});

win.bind("moduleEnable", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await enableModule(scope, name);
  return true;
});

win.bind("moduleRevoke", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await revokeModule(scope, name);
  return true;
});

win.bind("moduleCall", async (arg) => {
  const { moduleId, scope, method, payload } = arg as {
    moduleId: string;
    scope: string;
    method: string;
    payload: unknown;
  };
  const manifest = await manifestFor(scope, moduleId);
  if (!manifest) throw new Error(`no such module: ${moduleId}`);
  return await dispatch(
    manifest,
    scope,
    method,
    payload,
    handlersFor(moduleId),
  );
});

win.bind("chatStart", async (arg) => {
  const { cwd, scope, view, fresh } = arg as {
    cwd?: string;
    scope?: string;
    view?: string;
    fresh?: boolean;
  };
  return { id: await chat.startAgent({ cwd, scope, view, fresh }) };
});

win.bind("chatHistory", async (arg) => {
  const { id } = arg as { id: string };
  return chat.historyOf(id);
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

// Re-read prompt templates from disk into a running agent, so a template saved or
// approved in the Library module can be invoked without restarting the conversation.
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

win.bind("chatSetThinking", async (arg) => {
  const { id, level } = arg as { id: string; level: string };
  // deno-lint-ignore no-explicit-any
  chat.setThinkingLevel(id, level as any);
  return true;
});

// Model-provider management — connect any provider pi supports (see chat/providers.ts).
// API keys persist to ~/.pi/agent/auth.json; custom endpoints to ~/.pi/agent/models.json.
win.bind("providerList", async () => await providers.listProviders());

// Every model the connected providers offer, independent of any chat session — what
// the Settings model checklist offers.
win.bind("providerModels", async () => await providers.listModels());

win.bind("providerConnect", async (arg) => {
  const { id, value, method } = arg as {
    id: string;
    value: string;
    method?: string;
  };
  await providers.connectProvider(id, value, method);
  return true;
});

win.bind(
  "providerAwsProfiles",
  async () => await providers.detectAwsProfiles(),
);

win.bind("providerConnectAwsProfile", async (arg) => {
  const { name, region } = arg as { name: string; region?: string };
  await providers.connectAwsProfile(name, region);
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

// Scoped config — chat defaults, per scope. Read returns a scope's OWN values (what
// the settings UI edits); Resolve returns them layered onto root's (what an agent
// there actually sees).
win.bind("scopeConfigRead", async (arg) => {
  const { scope } = arg as { scope: string };
  return await scopeConfig.readScopeConfig(scope);
});

win.bind("scopeConfigWrite", async (arg) => {
  const { scope, data } = arg as { scope: string; data: unknown };
  await scopeConfig.writeScopeConfig(scope, data);
  return true;
});

win.bind("scopeConfigResolve", async (arg) => {
  const { scope } = arg as { scope: string };
  return await scopeConfig.resolveScopeConfig(scope);
});

// What a scope's agents ACTUALLY use when nothing overrides them: the resolved config
// with the compiled-in fallbacks filled in. Separate from scopeConfigResolve because
// the frontend cannot fill those in itself — the fallback model lives in chat/agent.ts.
win.bind("scopeChatDefaults", async (arg) => {
  const { scope } = arg as { scope: string };
  return chat.resolveChatDefaults(await scopeConfig.resolveScopeConfig(scope));
});

win.bind("openExternal", async (arg) => {
  const { url } = arg as { url: string };
  await dialog.openUrl(url);
  return null;
});

win.bind("listDir", async (arg) => {
  const { path } = arg as { path?: string };
  // path undefined → the workspace default; an absolute child path resolves to itself.
  return await fs.listDir(await moduleDir(path));
});

// File-tree edits. Same path convention as listDir: a parent of undefined means the
// workspace default, an absolute path resolves to itself. Every failure (bad name, name
// taken, permissions) throws through to the tree's error strip. removeEntry is permanent
// and recursive — the frontend gates it behind a confirmation unless it's turned off.
win.bind("createEntry", async (arg) => {
  const { parent, name } = arg as { parent?: string; name: string };
  return { path: await fs.createEntry(await moduleDir(parent), name) };
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
      await moduleDir(override),
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
  return { changes: await git.changedPaths(await moduleDir(path), depth) };
});

// Extensions — one concept covering both origins: loose `.ts` modules written by the
// user or by an agent, and installed pi packages. An extension runs iff it is in pi's
// own loading set for the scope (the extensions/ dir, or settings.json); it awaits
// review iff there is a file for it in pending/. Agents can only write into their
// scope's quarantine dir (extensions/agent-tools.ts), and extensionsFetch downloads a
// package WITHOUT enabling it, so enabling is always the human step and goes through
// here. extensionsList returns the scope's own; extensionsVisible adds what it
// inherits from root (local modules only — packages are not inherited).
win.bind("extensionsList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await extensions.listExtensions(scope);
});

win.bind("extensionsVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await extensions.listVisibleExtensions(scope);
});

win.bind("extensionsRead", async (arg) => {
  const { scope, id, state } = arg as {
    scope: string;
    id: string;
    state: "pending" | "enabled";
  };
  return await extensions.readExtension(scope, id, state);
});

win.bind("extensionsEnable", async (arg) => {
  const { scope, id, expectDigest } = arg as {
    scope: string;
    id: string;
    expectDigest: string;
  };
  await extensions.enableExtension(scope, id, expectDigest);
  return true;
});

// Enabled-but-unloadable extensions, for Library to mark. Builds a loader per call
// rather than caching: the answer is only interesting right after something changed.
win.bind("extensionsLoadErrors", async (arg) => {
  const { scope } = arg as { scope: string };
  return await extensions.extensionLoadErrors(scope);
});

win.bind("extensionsRevoke", async (arg) => {
  const { scope, id } = arg as { scope: string; id: string };
  await extensions.revokeExtension(scope, id);
  return true;
});

win.bind("extensionsRemove", async (arg) => {
  const { scope, id, state } = arg as {
    scope: string;
    id: string;
    state: "pending" | "enabled";
  };
  await extensions.removeExtension(scope, id, state);
  return true;
});

// Fetches the bytes into quarantine. Deliberately does NOT reach the loading set —
// the user reviews the resolved entry files first, same as for a local module.
win.bind("extensionsFetch", async (arg) => {
  const { scope, source } = arg as { scope: string; source: string };
  await extensions.fetchPackage(scope, source);
  return true;
});

win.bind("extensionsSearch", async (arg) => {
  const { query, type } = arg as {
    query: string;
    type?: "extension" | "skill" | "prompt" | "theme";
  };
  return await extensions.searchExtensions(query, type);
});

// Prompt templates — reusable messages invoked as `/name` in a Chat module, per scope.
// A human editing one here writes straight to live; agents can only write into the
// scope's quarantine dir (prompts/agent-tools.ts), so promptsApprove is what makes an
// agent-written template invocable. promptsList returns the scope's own templates; what a
// Chat module can actually invoke (its own plus root's) comes from pi via chatListCommands.
win.bind("promptsList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await prompts.listPrompts(scope);
});

win.bind("promptsSave", async (arg) => {
  const { scope, name, description, argumentHint, body } = arg as {
    scope: string;
    name: string;
    description: string;
    argumentHint?: string;
    body: string;
  };
  await prompts.savePrompt(scope, name, { description, argumentHint, body });
  return true;
});

win.bind("promptsApprove", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await prompts.approvePrompt(scope, name);
  return true;
});

win.bind("promptsReject", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await prompts.rejectPrompt(scope, name);
  return true;
});

win.bind("promptsDelete", async (arg) => {
  const { scope, name, state } = arg as {
    scope: string;
    name: string;
    state: "live" | "pending";
  };
  await prompts.deletePrompt(scope, name, state);
  return true;
});

// Skills — read-only listing; the Library sub-tab shows this list.
win.bind("skillsVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await skills.listVisibleSkills(scope);
});

// The scope's two prompt files, SYSTEM.md and APPEND_SYSTEM.md (docs/scopes.md). Unlike
// every other Library kind these are singletons addressed by KIND, not by name — there
// is one of each per scope — and the human half is the only half: no agent tool writes
// them, so there is no quarantine and no approve/reject pair. systemPromptsList returns
// the scope's OWN two, present or not; what an agent there actually runs with is
// resolved per session by scope/prompt.ts.
win.bind("systemPromptsList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await scopePrompt.listPromptFiles(scope);
});

// An empty body deletes rather than writes — scope/prompt.ts records why, and the
// Library's Save button relabels itself to say so.
win.bind("systemPromptsSave", async (arg) => {
  const { scope, kind, body } = arg as {
    scope: string;
    kind: "system" | "appendix";
    body: string;
  };
  await scopePrompt.savePromptFile(scope, kind, body);
  return true;
});

win.bind("systemPromptsDelete", async (arg) => {
  const { scope, kind } = arg as {
    scope: string;
    kind: "system" | "appendix";
  };
  await scopePrompt.deletePromptFile(scope, kind);
  return true;
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
scopeConfig = await import("./lib/scope/config.ts");
scopePrompt = await import("./lib/scope/prompt.ts");
const { serveDir } = await import("jsr:@std/http@^1/file-server");
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
