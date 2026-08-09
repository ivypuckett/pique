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
let kanban: typeof import("./lib/kanban/service.ts");
let extensions: typeof import("./lib/extensions/service.ts");
let prompts: typeof import("./lib/prompts/service.ts");
let automatons: typeof import("./lib/automatons/run.ts");
let automatonService: typeof import("./lib/automatons/service.ts");
let skills: typeof import("./lib/skills/service.ts");
let scopeConfig: typeof import("./lib/scope/config.ts");

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
// the automaton editor's model picker offers.
win.bind("providerModels", async () => await providers.listModels());

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

win.bind("pickDirectory", async (arg) => {
  const { startDir } = arg as { startDir?: string };
  const start = startDir && startDir.trim() !== ""
    ? startDir
    : await moduleDir();
  const path = await dialog.pickDirectory(start);
  return path ? { path } : null;
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
  return {
    diff: await git.gitDiff(await moduleDir(override), staged ?? false, path),
  };
});

win.bind("gitChanges", async (arg) => {
  const { path } = arg as { path?: string };
  const depth = settings.resolveGitScanDepth(
    await settings.readJson("settings"),
  );
  return { changes: await git.changedPaths(await moduleDir(path), depth) };
});

// Kanban: each scope has its own board DB; the service caches an open handle per
// scope, seeding a fresh board with the default columns.
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
  const { scope, statusId, name } = arg as {
    scope: string;
    statusId: string;
    name: string;
  };
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

// Reordering within a column. Unlike kanbanSetStatus this needs no reason: the card
// stays where it is, only its place in the column changes.
win.bind("kanbanMoveCard", async (arg) => {
  const { scope, cardId, position } = arg as {
    scope: string;
    cardId: string;
    position: number;
  };
  (await kanban.board(scope)).moveCard({ cardId, position });
  return true;
});

win.bind("kanbanSetStatus", async (arg) => {
  const { scope, cardId, statusId, reason } = arg as {
    scope: string;
    cardId: string;
    statusId: string;
    reason: string;
  };
  (await kanban.board(scope)).setStatus({
    cardId,
    statusId,
    reason,
    actor: "human",
  });
  return true;
});

win.bind("kanbanSetMetadata", async (arg) => {
  const { scope, cardId, title, description, tags, subtasks } = arg as {
    scope: string;
    cardId: string;
    title?: string;
    description?: string;
    tags?: Record<string, string>;
    subtasks?: { text: string; done: boolean }[];
  };
  (await kanban.board(scope)).setMetadata({
    cardId,
    title,
    description,
    tags,
    subtasks,
    actor: "human",
  });
  return true;
});

win.bind("kanbanSetConnections", async (arg) => {
  const { scope, cardId, artifacts, predecessors, successors } = arg as {
    scope: string;
    cardId: string;
    artifacts?: string[];
    predecessors?: string[];
    successors?: string[];
  };
  (await kanban.board(scope)).setConnections({
    cardId,
    artifacts,
    predecessors,
    successors,
    actor: "human",
  });
  return true;
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
    expectDigest?: string;
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
  const { query } = arg as { query: string };
  return await extensions.searchExtensions(query);
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

// Automatons — named agents that run unattended, each naming exactly the extensions
// and skills its run may load. automatonsList returns the scope's own definitions
// (what it can edit or delete); automatonsVisible adds what it inherits from root.
win.bind("automatonsList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await automatonService.listAutomatons(scope);
});

win.bind("automatonsVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await automatonService.listVisibleAutomatons(scope);
});

win.bind("automatonsSave", async (arg) => {
  // Renamed on the way out of the destructure: `extensions`, `skills`, and `kanban` are
  // also the names of module-level service imports at the top of this file, and
  // shadowing them here would make any later service call inside this handler resolve
  // to the arg's value instead.
  const {
    scope,
    name,
    description,
    prompt,
    extensions: extensionRefs,
    skills: skillRefs,
    tools,
    model,
    cron,
    kanban: kanbanColumn,
    wip,
  } = arg as {
    scope: string;
    name: string;
    description: string;
    prompt: string;
    extensions: string[];
    skills: string[];
    tools?: string[];
    model?: string;
    cron?: string;
    kanban?: string;
    wip?: number;
  };
  await automatonService.saveAutomaton(scope, name, {
    description,
    prompt,
    extensions: extensionRefs,
    skills: skillRefs,
    tools,
    model,
    cron,
    kanban: kanbanColumn,
    wip,
  });
  return true;
});

win.bind("automatonsDelete", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await automatonService.deleteAutomaton(scope, name);
  return true;
});

win.bind("automatonsLaunch", async (arg) => {
  const { scope, name, args, cwd: override } = arg as {
    scope: string;
    name: string;
    args?: string;
    cwd?: string;
  };
  return {
    id: await automatons.launchAutomaton({
      scope,
      name,
      cwd: await moduleDir(override),
      args,
    }),
  };
});

win.bind("automatonsRuns", async (arg) => {
  const { scope } = arg as { scope: string };
  return await automatons.listRuns(scope);
});

win.bind("automatonsHistory", async (arg) => {
  const { scope, id } = arg as { scope: string; id: string };
  return await automatons.runHistory(scope, id);
});

win.bind("automatonsRead", async (arg) => {
  const { id } = arg as { id: string };
  return await automatons.readRun(id);
});

win.bind("automatonsStop", async (arg) => {
  const { id } = arg as { id: string };
  await automatons.stopRun(id);
  return true;
});

// Skills — read-only listing (docs/automatons.md); the Library sub-tab shows this
// list and the automaton editor picks from it.
win.bind("skillsVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await skills.listVisibleSkills(scope);
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
settings = await import("./lib/settings/file.ts");
dialog = await import("./lib/settings/dialog.ts");
fs = await import("./lib/fs.ts");
git = await import("./lib/gitdiff/git.ts");
kanban = await import("./lib/kanban/service.ts");
extensions = await import("./lib/extensions/service.ts");
prompts = await import("./lib/prompts/service.ts");
automatons = await import("./lib/automatons/run.ts");
automatonService = await import("./lib/automatons/service.ts");
skills = await import("./lib/skills/service.ts");
scopeConfig = await import("./lib/scope/config.ts");
// Fold a pre-scope ~/.pique (global agent dir, boards/, settings sections) into
// ~/.pique/scopes/root before anything reads from the new locations. No-op once done.
await (await import("./lib/scope/migrate.ts")).migrateToScopes();
// A run lives in this process's memory, so every `running` record on disk belongs to a
// process that is gone. Turn those into `failed` before anything lists them.
await automatons.reconcileRuns();
// The cron trigger. After reconcileRuns, which the scheduler's "is it still running?"
// check depends on — a stale `running` record must be repaired before a schedule can
// consult the live map. Nothing catches up: minutes that passed while pique was closed
// are gone (automatons/schedule.ts).
(await import("./lib/automatons/schedule.ts")).startScheduler();
// The kanban trigger. Registered rather than imported by kanban/service.ts, which cannot
// import this module graph without closing a cycle through the pique:kanban tools. After
// reconcileRuns for the same reason the scheduler is: the dispatcher's guards consult the
// live map, and a stale `running` record must be repaired first.
{
  const kanbanTrigger = await import("./lib/automatons/kanban.ts");
  kanban.setCardArrivedHandler((scope, arrival) => {
    void kanbanTrigger.dispatchArrival(scope, arrival);
  });
}
const { serveDir } = await import("jsr:@std/http@^1/file-server");
Deno.serve((req) => serveDir(req, { fsRoot: "dist", quiet: true }));
