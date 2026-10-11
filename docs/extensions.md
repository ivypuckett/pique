# Extensions

How capability reaches pique's chat agent, and — at the end — what is known
broken and what this version deliberately does not do.

## One concept, two origins

An **extension** is the unit you install and delete. A **tool** is what an agent
calls. One extension registers one or more tools.

Extensions come from two origins, which differ only in how the bytes arrive:

| Origin      | What it is                             | Acquired by                                                |
| ----------- | -------------------------------------- | ---------------------------------------------------------- |
| **local**   | a loose `.ts` module                   | the agent writing one with pi's own tools, or you, by hand |
| **package** | a pi package from npm/git/a local path | Settings → Library, backed by pi's `DefaultPackageManager` |

An extension may also contribute a **module**: a panel in the right pane, drawn
by its own HTML. That is a second thing an extension can ship, not a second kind
of extension. An agent writes one with `define_module`. See
[modules.md](modules.md).

A third source is not an extension at all: `define_module` is **compiled into
pique** and passed to `createAgentSession` as a `customTool`. It is not
user-managed and does not appear in the list.

## Where they live

pique keeps a pi agent dir, laid out exactly as the `pi` CLI's `~/.pi/agent`,
and pi discovers what is in it itself. It is `~/.pique/agent` unless moved in
Settings → Library (point it at `~/.pi/agent` to share one setup with the CLI),
and "Import from pi" copies the CLI's setup in:

```
~/.pique/agent/
  extensions/        local modules — pi loads every `<name>.ts` here
  settings.json      installed packages — pi's own file
  npm/node_modules/… package bytes
```

> An extension **runs** iff it is in pi's own loading set: the `extensions/` dir
> for a local module, `settings.json` for a package.

There is no pique-side record that could disagree with what pi loads, and no
gate between writing a file and it running: an extension is trusted code. A
sandbox, if you want one, belongs in an extension of its own —
`pi.on("tool_call")` is where one would intercept what an agent does.

| Step    | local                     | package                                            |
| ------- | ------------------------- | -------------------------------------------------- |
| Install | write `extensions/<n>.ts` | `install(source)` + `addSourceToSettings(source)`  |
| View    | the file                  | the entry files `resolveExtensionSources()` yields |
| Delete  | `Deno.remove`             | `removeSourceFromSettings()` + `remove(source)`    |

Every change takes effect in Chat modules opened **afterwards**. A session
already running picks the change up when someone types **`/reload`** in it —
never on its own, so tools do not appear and vanish under a conversation without
being asked for.

---

## Known broken

### 1. Installing a package runs its install scripts

`npm install` runs the package's own lifecycle scripts as it downloads, before
you have seen a line of it. Install is therefore behind its own confirm, and the
warning says so. A package you would not run is a package you should not
install.

### 2. Viewing a package is not an audit

Expanding a package's row shows the entry files pi resolved, not the transitive
dependency tree.

### 3. A local-path package source is not what you typed

pi rewrites a local-path source relative to `agentDir` on the way into
`settings.json` (`/tmp/x/pkg` → `../../../../pkg`), and then resolves a _stored_
source against `agentDir` but a _supplied_ one against `cwd`. Handing the stored
form straight back matches nothing, and `removeSourceFromSettings` quietly
returns `false` — a delete that reports success and changes nothing.

`packages.ts` works around this by canonicalizing every local source to an
absolute path on the way out of `listPackages`, which both of pi's resolvers
agree on. `integration_test.ts` pins the behaviour. If that canonicalization is
ever removed, delete silently breaks for local-path packages only — npm and git
sources are unaffected.

### 4. Settings writes are queued, not synchronous

`addSourceToSettings` → `setPackages` → `save()` → an async write queue. The
change is visible immediately through the same `SettingsManager`, but the file
lands shortly after. Do not install and then read `settings.json` expecting to
see it. Chat sessions start much later, so this does not affect loading.

### 5. The npm-package boot panic — fixed upstream, needs Deno ≥ 2.9.4

A bisect on 2026-07-21 attributed a boot panic — `RefCell already borrowed` in
deno_core's `ModuleMap` — to pi dynamically importing an **installed npm
package** extension when `agentDir` is set, under the **desktop** runtime, with
`npm:pi-crew` configured.

It was an upstream deno_core bug, not a pique one: the synthetic-ESM cache-hit
path held an immutable `ModuleMapData` borrow across `module.evaluate()`, and a
dynamic import started during that evaluation needs a mutable borrow of the same
map. Fixed by [denoland/deno#36258](https://github.com/denoland/deno/pull/36258)
(merged 2026-07-22, fixes
[#36216](https://github.com/denoland/deno/issues/36216)), released in **Deno
2.9.4**. Nothing in pique worked around it and nothing needs to — the
requirement is just the Deno floor.

Earlier re-tests on 2026-07-27 and 2026-08-03 found it not reproducing, but
those ran on 2.9.3, which does _not_ carry the fix; they recorded the panic as
dormant, not absent. The table they produced has been dropped as misleading for
that reason.

If you need to confirm the fix is in a given Deno, check the source at the tag
rather than `git compare` — the commit reports as "diverged" from both v2.9.3
and v2.9.4 because releases are cut from a branch and this one was cherry-picked
under a different SHA. `grep 'let cached_handle = {' libs/core/modules/map.rs`
at the tag is the real test: absent in v2.9.3, present in v2.9.4.

### 6. An installed package may add no tools, and that is normal

Many pi packages ship **skills and commands** rather than tools — `npm:pi-crew`
is one: it resolves a single extension entry plus a dozen `SKILL.md` files, and
installing it adds zero entries to `getActiveToolNames()`. This looks identical
to a broken install. An expanded row lists the skills a package ships partly so
this is visible.

The genuinely broken case is distinguishable from it: an extension that fails to
**import** is still in pi's loading set, and pi's reload swallows the error, so
nothing in the list sets it apart. `service.ts:extensionLoadErrors` reads them
back off a loader, and the Library lists them above everything else. They are
shown as their own group rather than marked against a row, because a package's
failure names a file inside its install tree rather than the source string the
row shows, and matching the two up would quietly miss.

---

## Deferred

### 1. Live reload — shipped as `/reload`, with three pieces left

A running chat re-reads extensions, prompts, skills and its **base system
prompt** when someone types `/reload` in it. The mechanism is
`AgentSession.reload()`, a public SDK method rather than the TUI affair the
earlier note here assumed: it re-reads the resource loader, rebuilds the
extension runner from what that yields, and passes `includeAllExtensionTools`,
so a newly added extension's tools land in the session's _active_ set and not
merely its registry.

**An edited `SYSTEM.md` lands too.** There is no setter for the prompt, but
there does not need to be: pi rebuilds it from the resource loader inside
`reload()`, and the loader re-discovers the file. A deleted one restores pi's
own preamble. `chat/base_prompt_integration_test.ts` drives these against real
sessions, plus the invariant the notice depends on — that `chatReloadPrompts`,
which reloads the loader alone, leaves the running prompt where it is.

It is a typed command rather than an automatic consequence of an install, so
tools never change under a conversation that did not ask. pi does **not** expand
`/reload` — `session.prompt("/reload")` sends the literal text to the model
(pinned in `chat/reload_test.ts`) — so `chat/store.ts` intercepts it before it
becomes a turn, and `chat/agent.ts:listCommands` contributes the entry to the
`/` menu as the one command sourced from pique itself. The reply is a `notice`
line, styled as pique speaking rather than as the model, naming what was added,
removed, or failed to load — and, when they apply, that the system prompt was
updated and that the model default is not what this conversation runs. Tools
were once the only thing it mentioned, which left an applied `SYSTEM.md` edit
reported as "no tool changes".

Reporting failures there is the point of the summary: pi's reload swallows a
module that will not import, so without it a broken extension is
indistinguishable from one that was never installed.

**Resilience, measured rather than assumed.** `chat/reload_resilience_test.ts`
drives the cases that would make reload unsafe, against real sessions and real
extension modules on disk. What holds: an EDITED extension file reloads to its
new version (not a stale ESM module — the failure a test that only ever ADDS a
file would miss); a broken extension neither throws out of reload nor takes its
healthy siblings with it, and is named in `getExtensions().errors`; reloading
mid-turn is safe both while the turn is parked at the model and while an
extension's own tool is executing, despite `reload()` carrying no idle guard of
its own; two concurrent reloads leave a coherent, duplicate-free tool set; a
conversation that already CALLED a tool still runs after that tool is removed
and reloaded away; and 25 reloads converge on the same tool set with the session
still able to run a turn.

**What is left:**

- The **model default** is resolved in `startAgent` and a reload does not
  re-apply it: a conversation keeps the model it has been running rather than
  having one swapped in underneath it. It is _reported_ instead — the notice
  names the default when a new chat would come up on a different model, which
  happens when the pick was made in another view or on disk. A default that is
  merely unavailable is not mentioned, since a new chat would fall back to
  exactly what this session already took.
- Whether a **provider** accepts a request whose history names a tool absent
  from the current tool list is untested — the mock endpoint accepts anything.
  It only arises after a removal in a conversation that already used the tool.
- `session_start` **never fires for extensions in pique** — not on reload, and
  not at startup either. pique calls no `bindExtensions`, so pi's `hasBindings`
  check is false and the emit is skipped on both paths; an extension whose setup
  lives in that handler has never run here. The lifecycle one does see across a
  reload is `load → session_shutdown → load` (pinned in probe E), which is
  coherent for the module-scope setup pi's own docs demonstrate. Fixing it means
  passing bindings pique has no TUI use for, and changes behaviour for every
  extension — its own decision, not reload's.

### 2. Source validation

Nothing checks that a module in `extensions/` parses, default-exports a
function, or calls `pi.registerTool()`. A malformed one may throw during pi's
session startup, breaking **new chat sessions** rather than failing quietly. The
obvious check — importing it to see if it loads — _executes_ it.

### 3. Package updates

`checkForAvailableUpdates()` and `update()` exist in pi's package manager and
are unused. An "update available" affordance is a natural follow-up.
