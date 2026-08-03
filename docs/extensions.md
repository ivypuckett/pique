# Extensions

How capability reaches pique's chat agent, how a human gates it, and — at the
end — what is known broken and what this version deliberately does not do.

## One concept, two origins

An **extension** is the unit you acquire, review, enable and revoke. A **tool**
is what an agent calls. One extension registers one or more tools; that is why
the agent-facing tool is `define_extension` and not `define_tool`.

Extensions come from two origins, which differ only in how the bytes arrive:

| Origin      | What it is                             | Acquired by                                                   |
| ----------- | -------------------------------------- | ------------------------------------------------------------- |
| **local**   | a loose `.ts` module                   | `define_extension`, or dropping a file in by hand             |
| **package** | a pi package from npm/git/a local path | Settings → Extensions, backed by pi's `DefaultPackageManager` |

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

Every change takes effect in Chat modules opened **afterwards**. Sessions
already running keep what they loaded until they restart.

## The review gate

Both origins get the same gate: the UI will not enable an extension until its
code has been expanded, because approving without looking is the failure mode
worth designing against.

For a package this is possible because `resolveExtensionSources()` works on a
source that is installed but _not_ configured (verified 2026-08-03) — so you
read the entry files pi would execute, not a source string you typed.

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

**Packages are not inherited** — install them per scope. This is deliberate, not
an oversight; see [scopes.md](scopes.md) deferred #1. The Settings list labels
the inherited group accordingly, because one merged list would otherwise imply a
symmetry that does not exist.

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

---

## Deferred

### 1. Enforcing the gate (`tool_call` interception)

The gate is advisory, per above. Making it real means a pique-owned pi extension
using `pi.on("tool_call")` to block `write`/`edit`/`bash` calls whose target
resolves inside the scope's `agent/` dir. Blocking `bash` reliably is the hard
part — it means inspecting a shell command string for writes to a path, which is
not robustly decidable. Expect to catch the common cases, not all of them.

Restricting the tool set outright is the other half, and also unbuilt since
profiles were removed. pi still takes an `allowedToolNames` allowlist at session
creation and exposes `setActiveToolsByName` on a live session, so the mechanism
is there — what is missing is anything in pique that decides what to pass.

### 2. Live reload into running sessions

Enable and revoke take effect only in Chat modules opened afterwards, and the UI
says so. pi has `ctx.reload()`, and `examples/extensions/reload-runtime.ts`
shows the idiom (a tool queues `/reload` via
`pi.sendUserMessage(..., {deliverAs: "followUp"})`, because tools get
`ExtensionContext` and cannot call `ctx.reload()` directly).

Unverified: whether `/reload` survives pique's `session.prompt()` path. pique
omits pi's builtin commands from its `/` menu (`chat/agent.ts:listCommands`), so
a builtin may or may not run here. Test before building on it.

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

Settings → Extensions reviews, enables, revokes and deletes. It does not let a
user _write_ one — authoring by hand means dropping a `.ts` file into a scope's
`pending/` (or straight into `extensions/`, which is self-approval and fine for
a human).

### 6. Rejected-extension memory

Delete removes the file. An agent can immediately re-define the same extension,
and nothing records that a human already said no. Now true of packages too:
deleting a fetched package leaves no trace that it was refused.
