# Defined tools

How users and agents add tools to pique's chat agent, and — at the end — everything
this first version deliberately does not do.

> **Tools are per-scope now.** Everything below still holds, but the two directories
> belong to a *scope* (the root workspace, or one numbered workspace) rather than
> being global. A workspace agent gets its own approved tools plus root's. See
> [scopes.md](scopes.md), which closes deferred item #4 below.

## Where tools come from

There are three sources, in increasing order of dynamism:

1. **Compiled in.** `kanbanTools()` and `toolAuthoringTools()` in `src/lib/*/agent-tools.ts`,
   passed to `createAgentSession` as `customTools` (see `chat/agent.ts:startAgent`).
   Adding one means editing pique and rebuilding.
2. **Installed pi packages.** Settings → Extensions, backed by `chat/extensions.ts`
   (`DefaultPackageManager`). Third-party code from npm/git. Per-scope, but not
   inherited from root — see [scopes.md](scopes.md), Deferred #1.
3. **Defined tools** — this document. Loose pi extension modules under a scope's
   `agent/` dir, written by the user or by an agent calling `define_tool`.

## The two directories

pi auto-discovers `<agentDir>/extensions/*.ts` (and `*/index.ts`) and **executes every
module there at session start**. That is the whole basis of the design:

| Dir | Loaded by pi? | Meaning |
| --- | --- | --- |
| `~/.pique/scopes/<scope>/agent/extensions/` | yes | approved — this code runs |
| `~/.pique/scopes/<scope>/agent/pending/` | no | quarantined — never executes |

where `<scope>` is `root` or a workspace id. A workspace's agent is started with its
own dir as `agentDir` and root's approved files as `additionalExtensionPaths`, so it
loads both sets.

Approval is a **rename** from `pending/` into `extensions/` (`tools/service.ts:approveTool`).
There is no approval flag or ledger, because a flag could disagree with what pi
actually loads; the file's location cannot.

`define_tool` (`tools/agent-tools.ts`) can only ever write into `pending/`. The agent's
stated rationale is prepended to the source as a comment, so the reviewer reads intent
and code as one artifact.

## Flow

```
agent calls define_tool  →  <scope>/agent/pending/<name>.ts   (inert)
user reviews source in Settings → Tools
  Approve  →  mv into extensions/  →  loaded by chat sessions started afterwards
  Reject   →  deleted
```

The UI requires expanding the source before Approve enables — approving without
looking is the failure mode worth designing against.

## What the gate is and is not

**It is** a curation and visibility boundary. Nothing an agent authors becomes a
persistent, silently-loaded capability without a human reading it first.

**It is not** containment. The chat agent has `bash`, `write`, and `edit` in its active
tool set, so it can write directly into `extensions/` and bypass `define_tool`
entirely. Closing that hole is the first item below.

---

## Deferred

Everything below was consciously left out of the first version.

### 1. Enforcing the gate (`tool_call` interception)

The gate is currently advisory, per above. Making it real means a pique-owned pi
extension using `pi.on("tool_call")` to block `write`/`edit`/`bash` calls whose target
resolves inside the scope's `agent/` dir. This is the documented "permission gate" pattern
(`docs/extensions.md`, Tool Events). Blocking `bash` reliably is the hard part —
it means inspecting a shell command string for writes to a path, which is not
robustly decidable. Expect to catch the common cases, not all of them.

### 2. Live reload into running sessions

Approve and Revoke currently take effect only in Chat modules opened afterwards, and
the UI says so. pi has `ctx.reload()`, and `examples/extensions/reload-runtime.ts`
shows the idiom (a tool queues `/reload` via `pi.sendUserMessage(..., {deliverAs: "followUp"})`,
because tools get `ExtensionContext` and cannot call `ctx.reload()` directly).

Unverified: whether `/reload` survives pique's `session.prompt()` path. pique omits
pi's builtin commands from its `/` menu (`chat/agent.ts:listCommands`) on the grounds
that they're TUI actions, so a builtin may or may not run here. Test before building on it.

Revoke has the sharper version of this problem: a revoked tool stays live in every
running session until it restarts.

### 3. Source validation at approve time

Nothing checks that an approved module parses, default-exports a function, or calls
`pi.registerTool()`. A malformed approved extension may throw during pi's session
startup, which would break **new chat sessions** rather than just failing quietly.

The obvious check — importing the module to see if it loads — *executes* it, which is
arguably fine post-approval but merits thought about ordering. Also relevant: dynamic
`import()` is exactly the operation implicated in item 5.

### 4. Per-workspace tools — **done**

Superseded: tools are scoped to the root workspace or a numbered one, and a workspace
inherits root's. See [scopes.md](scopes.md). The mechanism turned out not to be pi's
project-local `.pi/extensions/` but `DefaultResourceLoader`'s
`additionalExtensionPaths`, which takes explicit file paths.

### 5. The npm-package boot panic

A bisect on 2026-07-21 attributed a boot panic — `RefCell already borrowed` in
deno_core's `ModuleMap` — to pi dynamically importing an **installed npm package**
extension when `agentDir` is set, under the **desktop** runtime (`deno desktop`),
with `npm:pi-crew` in what is now `~/.pique/scopes/root/agent/settings.json`.

Re-checked on 2026-07-27 against Deno 2.9.3: a **loose `.ts` extension** in
`<agentDir>/extensions/` loads cleanly with no panic, verified by driving
`createAgentSession` directly and reading back `getActiveTools()`. That is the path
this feature uses, so defined tools are not believed to be affected.

Not re-tested: npm-package extensions, and either path under the desktop webview binary
rather than plain `deno run`. If the panic resurfaces, the workarounds recorded then
were to uninstall the package or drop the `agentDir` line — the latter would disable
this feature, so prefer the former.

### 6. Editing tools in the UI

Settings → Tools reviews, approves, and revokes. It does not let a user *write* a tool —
authoring by hand means dropping a `.ts` file into a scope's `agent/pending/` (or
straight into `extensions/`, which is self-approval and fine for a human). An in-app
editor is a natural follow-up.

### 7. Rejected-tool memory

Reject deletes the file. An agent can immediately re-define the same tool, and nothing
records that a human already said no.
