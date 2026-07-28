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
let git: typeof import("./lib/gitdiff/git.ts");
let kanban: typeof import("./lib/kanban/service.ts");
let definedTools: typeof import("./lib/tools/service.ts");
let profiles: typeof import("./lib/profiles/service.ts");
let scopeConfig: typeof import("./lib/scope/config.ts");

// A module with no cwd of its own inherits the root workspace's, which lives in the
// layout tree — so working-directory resolution reads "layout", not "settings".
async function moduleDir(override?: string): Promise<string> {
  return settings.resolveModuleDir(override, await settings.readJson("layout"));
}

win.bind("termStart", async (arg) => {
  const { cols, rows, cwd: override, argv } = arg as {
    cols: number;
    rows: number;
    cwd?: string;
    argv?: string[];
  };
  return { id: term.startSession({ cols, rows, cwd: await moduleDir(override), argv }) };
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
  // `profile` is passed through as-is: undefined means "the scope's default" and ""
  // means "no profile", a distinction startAgent relies on.
  const { cwd, scope, profile } = arg as { cwd?: string; scope?: string; profile?: string };
  return { id: await chat.startAgent({ cwd, scope, profile }) };
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

// Pi-extension management — one package set per scope, under that scope's agent dir.
// installExtension fetches from npm/git and writes the scope's settings.json; the
// frontend gates it behind a confirm.
win.bind("extList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await extensions.listExtensions(scope);
});

win.bind("extSearch", async (arg) => {
  const { query } = arg as { query: string };
  return await extensions.searchExtensions(query);
});

win.bind("extInstall", async (arg) => {
  const { scope, source } = arg as { scope: string; source: string };
  await extensions.installExtension(scope, source);
  return true;
});

win.bind("extRemove", async (arg) => {
  const { scope, source } = arg as { scope: string; source: string };
  await extensions.removeExtension(scope, source);
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

// Scoped config — chat defaults and Kanban seed statuses, per scope. Read returns a
// scope's OWN values (what the settings UI edits); Resolve returns them layered onto
// root's (what an agent there actually sees).
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

win.bind("pickDirectory", async (arg) => {
  const { startDir } = arg as { startDir?: string };
  const start = startDir && startDir.trim() !== "" ? startDir : await moduleDir();
  const path = await dialog.pickDirectory(start);
  return path ? { path } : null;
});

win.bind("listDir", async (arg) => {
  const { path } = arg as { path?: string };
  // path undefined → the workspace default; an absolute child path resolves to itself.
  return await fs.listDir(await moduleDir(path));
});

win.bind("gitDiff", async (arg) => {
  const { cwd: override, staged, path } = arg as { cwd?: string; staged?: boolean; path?: string };
  return { diff: await git.gitDiff(await moduleDir(override), staged ?? false, path) };
});

win.bind("gitChanges", async (arg) => {
  const { path } = arg as { path?: string };
  const depth = settings.resolveGitScanDepth(await settings.readJson("settings"));
  return { changes: await git.changedPaths(await moduleDir(path), depth) };
});

// Kanban: each scope has its own board DB; the service caches an open handle per
// scope, seeding a fresh board from that scope's resolved kanban.defaultStatuses.
// The frontend passes the scope it wants — its own workspace, or "root" to work the
// shared board. All mutations on this path are the human UI, so actor is "human".
win.bind("kanbanGetBoard", async (arg) => {
  const { scope } = arg as { scope: string };
  return (await kanban.board(scope)).getBoard();
});

win.bind("kanbanGetLogs", async (arg) => {
  const { scope, cardId } = arg as { scope: string; cardId?: string };
  return (await kanban.board(scope)).getLogs(cardId);
});

// Column edits. Same scope argument as every other kanban call, so a workspace can edit
// the shared root board's columns and nothing can reach a workspace board from outside.
// board.ts refuses a blank name, a column that still has cards, and the last column; the
// thrown message surfaces in the module's error strip.
win.bind("kanbanAddStatus", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  return { id: (await kanban.board(scope)).addStatus({ name }) };
});

win.bind("kanbanRenameStatus", async (arg) => {
  const { scope, statusId, name } = arg as { scope: string; statusId: string; name: string };
  (await kanban.board(scope)).renameStatus({ statusId, name });
  return true;
});

win.bind("kanbanMoveStatus", async (arg) => {
  const { scope, statusId, position } = arg as {
    scope: string;
    statusId: string;
    position: number;
  };
  (await kanban.board(scope)).moveStatus({ statusId, position });
  return true;
});

win.bind("kanbanDeleteStatus", async (arg) => {
  const { scope, statusId, withCards } = arg as {
    scope: string;
    statusId: string;
    withCards?: boolean;
  };
  (await kanban.board(scope)).deleteStatus({ statusId, withCards });
  return true;
});

win.bind("kanbanCreateCard", async (arg) => {
  const { scope, statusId, title, description } = arg as {
    scope: string;
    statusId: string;
    title?: string;
    description?: string;
  };
  const id = (await kanban.board(scope)).createCard({
    statusId,
    title,
    description,
    actor: "human",
  });
  return { id };
});

win.bind("kanbanDeleteCard", async (arg) => {
  const { scope, cardId } = arg as { scope: string; cardId: string };
  (await kanban.board(scope)).deleteCard(cardId);
  return true;
});

win.bind("kanbanSetStatus", async (arg) => {
  const { scope, cardId, statusId, reason } = arg as {
    scope: string;
    cardId: string;
    statusId: string;
    reason: string;
  };
  (await kanban.board(scope)).setStatus({ cardId, statusId, reason, actor: "human" });
  return true;
});

win.bind("kanbanSetMetadata", async (arg) => {
  const { scope, cardId, title, description, tags } = arg as {
    scope: string;
    cardId: string;
    title?: string;
    description?: string;
    tags?: Record<string, string>;
  };
  (await kanban.board(scope)).setMetadata({ cardId, title, description, tags, actor: "human" });
  return true;
});

win.bind("kanbanSetConnections", async (arg) => {
  const { scope, cardId, artifacts, predecessors, successors, parentId } = arg as {
    scope: string;
    cardId: string;
    artifacts?: string[];
    predecessors?: string[];
    successors?: string[];
    parentId?: string | null;
  };
  (await kanban.board(scope)).setConnections({
    cardId,
    artifacts,
    predecessors,
    successors,
    parentId,
    actor: "human",
  });
  return true;
});

// Defined tools — user- and agent-authored pi extensions, per scope. Agents can only
// write into their scope's quarantine dir (tools/agent-tools.ts); approving is what
// moves a tool into the dir pi actually loads, so it goes through here. toolsList
// returns the scope's own tools; toolsVisible adds the ones it inherits from root.
win.bind("toolsList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await definedTools.listTools(scope);
});

win.bind("toolsVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await definedTools.listVisibleTools(scope);
});

win.bind("toolsRead", async (arg) => {
  const { scope, name, state } = arg as {
    scope: string;
    name: string;
    state: "pending" | "approved";
  };
  return { source: await definedTools.readSource(scope, name, state) };
});

win.bind("toolsApprove", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await definedTools.approveTool(scope, name);
  return true;
});

win.bind("toolsReject", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await definedTools.rejectTool(scope, name);
  return true;
});

win.bind("toolsRevoke", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await definedTools.revokeTool(scope, name);
  return true;
});

// Profiles — a named base prompt plus a tool allowlist, per scope. Agents can only write
// into their scope's quarantine dir (profiles/agent-tools.ts); approving is what makes a
// profile selectable, so it goes through here. profilesList returns the scope's own
// profiles; profilesVisible is what a Chat module there can select (its own plus root's).
win.bind("profilesList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await profiles.listProfiles(scope);
});

win.bind("profilesVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await profiles.listVisibleProfiles(scope);
});

win.bind("profilesApprove", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await profiles.approveProfile(scope, name);
  return true;
});

win.bind("profilesReject", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await profiles.rejectProfile(scope, name);
  return true;
});

win.bind("profilesRevoke", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await profiles.revokeProfile(scope, name);
  return true;
});

win.addEventListener("close", () => {
  term?.killAllSessions();
  kanban?.closeAllBoards();
});

// Bindings are attached; now load deps and serve the static Vite build.
// deno desktop auto-navigates the adopted window to the served address.
term = await import("./lib/terminal/pty.ts");
chat = await import("./lib/chat/agent.ts");
providers = await import("./lib/chat/providers.ts");
extensions = await import("./lib/chat/extensions.ts");
settings = await import("./lib/settings/file.ts");
dialog = await import("./lib/settings/dialog.ts");
fs = await import("./lib/fs.ts");
git = await import("./lib/gitdiff/git.ts");
kanban = await import("./lib/kanban/service.ts");
definedTools = await import("./lib/tools/service.ts");
profiles = await import("./lib/profiles/service.ts");
scopeConfig = await import("./lib/scope/config.ts");
// Fold a pre-scope ~/.pique (global agent dir, boards/, settings sections) into
// ~/.pique/scopes/root before anything reads from the new locations. No-op once done.
await (await import("./lib/scope/migrate.ts")).migrateToScopes();
const { serveDir } = await import("jsr:@std/http@^1/file-server");
Deno.serve((req) => serveDir(req, { fsRoot: "dist", quiet: true }));
