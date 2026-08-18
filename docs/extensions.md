# Extensions

How capability reaches pique's chat agent, how a human gates it, and — at the
end — what is known broken and what this version deliberately does not do.

## One concept, two origins

An **extension** is the unit you acquire, review, enable and revoke. A **tool**
is what an agent calls. One extension registers one or more tools; that is why
the agent-facing tool is `define_extension` and not `define_tool`.

Extensions come from two origins, which differ only in how the bytes arrive:

| Origin      | What it is                             | Acquired by                                                |
| ----------- | -------------------------------------- | ---------------------------------------------------------- |
| **local**   | a loose `.ts` module                   | `define_extension`, or dropping a file in by hand          |
| **package** | a pi package from npm/git/a local path | the Library module, backed by pi's `DefaultPackageManager` |

A third source is not an extension at all: tools **compiled into pique**
(`kanbanTools`, `promptAuthoringTools`, `define_extension` itself) are passed to
`createAgentSession` as `customTools`. They are not user-managed and do not
appear in the list.

## The rule

> An extension **runs** iff it is in pi's own loading set for the scope. It is
> **awaiting review** iff there is a file for it in that scope's `pending/` dir.

Both halves are things pi or the filesystem already tells us, so there is no
separate "approved" flag that could disagree with what actually loads.

```
~/.pique/scopes/<root|ws-N>/agent/
  extensions/                 enabled local modules — pi auto-discovers these
  pending/
    lookup_weather.ts         a local module awaiting review
    npm%3Api-crew.json        a package awaiting review: {source, installedPath, requestedAt}
  settings.json               enabled packages — pi's own file
  npm/node_modules/…          fetched package bytes, enabled or not
```

The pending filename for a package is `encodeURIComponent(source)`, which is
reversible and cannot contain a separator — so the quarantine dir stays a set of
files whose _presence_ is the record, rather than a ledger whose entries could
drift.

## Lifecycle

| Step           | local                            | package                                              |
| -------------- | -------------------------------- | ---------------------------------------------------- |
| Acquire        | `define_extension` writes source | `install(source)` — fetches, does **not** register   |
| Pending record | `pending/<name>.ts`              | `pending/<slug>.json`                                |
| Review shows   | the file                         | the entry files `resolveExtensionSources()` resolves |
| Enable         | rename → `extensions/`           | `addSourceToSettings()`, then drop the pending file  |
| Enabled record | file in `extensions/`            | entry in `settings.json`                             |
| Revoke         | rename → `pending/`              | `removeSourceFromSettings()` — bytes stay            |
| Delete         | `Deno.remove`                    | `remove(source)`                                     |

Revoke is deliberately **not** a delete: it returns the extension to review, so
re-enabling something you previously turned off means reading it again.

Every change takes effect in Chat modules opened **afterwards**. A session
already running picks the change up when someone types **`/reload`** in it —
never on its own, so tools do not appear and vanish under a conversation without
being asked for.

## The review gate

Both origins get the same gate: the UI will not enable an extension until its
code has been expanded, because approving without looking is the failure mode
worth designing against.

For a package this is possible because `resolveExtensionSources()` works on a
source that is installed but _not_ configured (verified 2026-08-03) — so you
read the entry files pi would execute, not a source string you typed.

**The reading is what gets enabled.** `readExtension` returns a SHA-256 digest
of the full bytes — not the clamped text the review pane shows, or a long file
could differ past the cut and still match — and Enable hands it back.
`enableExtension` re-reads and refuses on a mismatch, so a Library tab left open
between reviewing in the morning and enabling in the afternoon cannot approve
something an agent rewrote in between. The check is in the service rather than
the component deliberately: in the component it would be a courtesy that any
other caller could skip.

**What the gate is:** a curation and visibility boundary. Nothing becomes a
persistent, silently-loaded capability without a human reading it first.

**What it is not:** containment. The chat agent has `bash`, `write` and `edit`
in its active tool set, so it can write directly into `extensions/` and bypass
`define_extension` entirely. **There is no containment story in pique today** —
restricting an agent's tool set was a profile's `tools:` allowlist, and profiles
are gone ([prompts.md](prompts.md)). See deferred #1.

## Inheritance

Local extensions are inherited: a workspace agent loads its own scope's
`extensions/` plus root's, assembled in `chat/agent.ts` via
`additionalExtensionPaths`.

**Packages are inherited too**, as of the same wiring. They travel a different
route to get there: a local module is already a file path, while a package has
to be resolved through its owning scope's package manager to the entry files pi
would run, because `additionalExtensionPaths` takes FILES — handing it the
package's directory fails with "Cannot find module" and it silently never loads.
`service.ts:inheritedExtensionPaths` is where both are assembled, and
`chat/scope_integration_test.ts` drives root's package through to a workspace
agent's tool list.

Only ENABLED packages inherit; one awaiting review is not enabled anywhere. A
source that will not resolve is skipped rather than thrown, so one broken
package in root cannot stop every workspace agent from starting — it still shows
up under `extensionLoadErrors`, which loads the same set.

---

## Known broken

### 1. Fetching a package runs its install scripts

Quarantine governs whether pi **loads** an extension. It does not stop
`npm install` from running the package's own lifecycle scripts at fetch time,
which happens _before_ any review is possible. The download is therefore gated
behind its own confirm, and the warning says so. A package you would not run is
a package you should not fetch.

### 2. Reviewing a package is not an audit

You read the entry files pi resolved, not the transitive dependency tree. That
is strictly better than approving a source string, and strictly worse than
reading everything that will execute. The UI states which one it is.

### 3. A local-path package source is not what you typed

pi rewrites a local-path source relative to `agentDir` on the way into
`settings.json` (`/tmp/x/pkg` → `../../../../pkg`), and then resolves a _stored_
source against `agentDir` but a _supplied_ one against `cwd`. Handing the stored
form straight back matches nothing, and `removeSourceFromSettings` quietly
returns `false` — a revoke that reports success and changes nothing.

`packages.ts` works around this by canonicalizing every local source to an
absolute path on the way out of `listEnabledPackages`, which both of pi's
resolvers agree on. `integration_test.ts` pins the behaviour. If that
canonicalization is ever removed, revoke silently breaks for local-path packages
only — npm and git sources are unaffected.

### 4. Settings writes are queued, not synchronous

`addSourceToSettings` → `setPackages` → `save()` → an async write queue. The
change is visible immediately through the same `SettingsManager`, but the file
lands shortly after. Do not enable and then read `settings.json` expecting to
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

### 6. An enabled package may add no tools, and that is normal

Many pi packages ship **skills and commands** rather than tools — `npm:pi-crew`
is one: it resolves a single extension entry plus a dozen `SKILL.md` files, and
enabling it adds zero entries to `getActiveToolNames()`. This looks identical to
a broken install. The review pane lists the skills a package ships partly so
this is visible before enabling.

The genuinely broken case is now distinguishable from it: an extension that
fails to **import** is still `enabled` by this module's invariant — the file is
in pi's loading set — and pi's reload swallows the error, so nothing in the list
sets it apart. `service.ts:extensionLoadErrors` reads them back off a loader
built the way `chat/agent.ts` builds one, and Library lists them above Enabled.
They are shown as their own group rather than marked against a row, because a
package's failure names a file inside its install tree rather than the source
string the row shows, and matching the two up would quietly miss.

---

## Deferred

### 1. Enforcing the gate (`tool_call` interception)

The gate is advisory, per above. Making it real means a pique-owned pi extension
using `pi.on("tool_call")` to block `write`/`edit`/`bash` calls whose target
resolves inside the scope's `agent/` dir. Blocking `bash` reliably is the hard
part — it means inspecting a shell command string for writes to a path, which is
not robustly decidable. Expect to catch the common cases, not all of them.

Restricting the tool set outright is the other half, and is now built **for
automatons only**: an automaton file's `tools:` key names which builtins its run
keeps ([automatons.md](automatons.md)). It is implemented with pi's denylist
rather than its `allowedToolNames` allowlist, because the allowlist filters
extension tools and `pique:` groups too — a restriction meant to remove `bash`
would silently remove everything the run's `extensions:` had just resolved.

Chat has no equivalent and no surface asking for one; a chat agent still gets
every builtin. That asymmetry is deliberate rather than pending: an automaton
runs unattended, which is where a smaller set of levers is worth the
configuration.

**Choosing what loads is not the same as containment, and cannot substitute for
it.** `DefaultResourceLoader` takes `noExtensions` / `noSkills` /
`noPromptTemplates`, and with one of those set the corresponding resource set
becomes exactly the `additional*Paths` it was handed (verified against the SDK
at 0.83 — `includeDefaults` is already always `false`, so nothing auto-scans
back in). That composes a session's **extension and skill** surface precisely,
and it is a real boundary for anything an extension registers. It does nothing
about pi's own builtins: `read`, `write`, `edit`, `bash` and `grep` are present
in every session regardless. So a session that cannot modify the filesystem is
not expressible by resource selection alone — that needs the allowlist above,
and any UI built on `no*` should avoid language ("sandbox", "restricted") that
would claim otherwise.

### 2. Live reload — shipped as `/reload`, with three pieces left

A running chat re-reads extensions, prompts, skills and its **base system
prompt** when someone types `/reload` in it. The mechanism is
`AgentSession.reload()`, a public SDK method rather than the TUI affair the
earlier note here assumed: it re-reads the resource loader, rebuilds the
extension runner from what that yields, and passes `includeAllExtensionTools`,
so a newly enabled extension's tools land in the session's _active_ set and not
merely its registry.

**An edited `SYSTEM.md` lands too**, which an earlier note here denied. There is
indeed no setter for the prompt, but there does not need to be: pi rebuilds it
from the resource loader inside `reload()`, so a loader that re-resolves is
enough. What made the edit invisible was pique's own doing — `startAgent` handed
the loader the file's _contents_, a string captured once, and the loader only
re-reads a source it can treat as a path. It now passes the loader's
`systemPromptOverride` **callback** instead, which the loader invokes afresh on
every reload. That re-runs the whole chain resolution rather than re-reading one
pinned file, so the three cases beyond a plain edit behave: a workspace
`SYSTEM.md` created later starts shadowing root's, a deleted one falls back to
the next on the chain, and deleting the last one restores pi's own preamble.
`chat/base_prompt_integration_test.ts` drives all four against real sessions,
plus the invariant the notice depends on — that `chatReloadPrompts`, which
reloads the loader alone, leaves the running prompt where it is.

It is a typed command rather than an automatic consequence of Enable, so tools
never change under a conversation that did not ask. pi does **not** expand
`/reload` — `session.prompt("/reload")` sends the literal text to the model
(pinned in `chat/reload_test.ts`) — so `chat/store.ts` intercepts it before it
becomes a turn, and `chat/agent.ts:listCommands` contributes the entry to the
`/` menu as the one command sourced from pique itself. The reply is a `notice`
line, styled as pique speaking rather than as the model, naming what was added,
removed, or failed to load — and, when they apply, that the system prompt was
updated and that the scope's model default is not what this conversation runs.
Tools were once the only thing it mentioned, which left an applied `SYSTEM.md`
edit reported as "no tool changes".

Reporting failures there is the point of the summary: pi's reload swallows a
module that will not import, so without it a broken extension is
indistinguishable from one that was never enabled.

**Resilience, measured rather than assumed.** `chat/reload_resilience_test.ts`
drives the cases that would make reload unsafe, against real sessions and real
extension modules on disk. What holds: an EDITED extension file reloads to its
new version (not a stale ESM module — the failure a test that only ever ADDS a
file would miss); a broken extension neither throws out of reload nor takes its
healthy siblings with it, and is named in `getExtensions().errors`; reloading
mid-turn is safe both while the turn is parked at the model and while an
extension's own tool is executing, despite `reload()` carrying no idle guard of
its own; two concurrent reloads leave a coherent, duplicate-free tool set; a
conversation that already CALLED a tool still runs after that tool is revoked
and reloaded away; and 25 reloads converge on the same tool set with the session
still able to run a turn.

**What is left:**

- The scope's **model default** is resolved in `startAgent` and a reload does
  not re-apply it: a conversation keeps the model it has been running rather
  than having one swapped in underneath it. It is now _reported_ instead — the
  notice names the scope's default when a new chat here would come up on a
  different model, which happens when the pick was made in another view or on
  disk. A default that is merely unavailable is not mentioned, since a new chat
  would fall back to exactly what this session already took.
- Whether a **provider** accepts a request whose history names a tool absent
  from the current tool list is untested — the mock endpoint accepts anything.
  It only arises after a revoke in a conversation that already used the tool.
- `session_start` **never fires for extensions in pique** — not on reload, and
  not at startup either. pique calls no `bindExtensions`, so pi's `hasBindings`
  check is false and the emit is skipped on both paths; an extension whose setup
  lives in that handler has never run here. The lifecycle one does see across a
  reload is `load → session_shutdown → load` (pinned in probe E), which is
  coherent for the module-scope setup pi's own docs demonstrate. Fixing it means
  passing bindings pique has no TUI use for, and changes behaviour for every
  extension — its own decision, not reload's.

### 3. Source validation at enable time

Nothing checks that an enabled module parses, default-exports a function, or
calls `pi.registerTool()`. A malformed one may throw during pi's session
startup, breaking **new chat sessions** rather than failing quietly. The obvious
check — importing it to see if it loads — _executes_ it, which is arguably fine
post-review but merits thought about ordering.

### 4. Package updates

`checkForAvailableUpdates()` and `update()` exist in pi's package manager and
are unused. An "update available" affordance is a natural follow-up — and under
the revoke rule above, an update arguably belongs back in review.

### 5. Editing extensions in the UI

The Library module reviews, enables, revokes and deletes. It does not let a user
_write_ one — authoring by hand means dropping a `.ts` file into a scope's
`pending/` (or straight into `extensions/`, which is self-approval and fine for
a human).

### 6. Rejected-extension memory

Delete removes the file. An agent can immediately re-define the same extension,
and nothing records that a human already said no. Now true of packages too:
deleting a fetched package leaves no trace that it was refused.
