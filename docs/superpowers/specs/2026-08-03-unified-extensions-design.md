# Unified Extensions — Design

**Date:** 2026-08-03
**Status:** Implemented (2026-08-03). See [extensions.md](../../extensions.md) for the
feature doc; deviations from this spec are recorded at the end.

## Purpose

Collapse pique's two capability-management surfaces — Settings → **Tools** (loose `.ts`
modules, user- or agent-authored) and Settings → **Extensions** (installed pi packages) —
into one concept, one UI and one lifecycle. Both already produce pi extension modules that
pi executes at session start; the split is provenance, and provenance should be a badge on
a row rather than a separate feature.

The mechanism unifies too, not just the naming: a package stops being installed-and-live in
one click and goes through the same review gate an agent-authored module does.

## Scope

**In:**

- One Settings → Extensions section listing both origins, grouped by state.
- One lifecycle — acquire → pending → enabled → disabled — with per-origin implementations.
- A real code-review gate for packages: the reviewer reads the entry files that will run.
- `src/lib/tools/` and `src/lib/chat/extensions.ts` merged into `src/lib/extensions/`;
  the `tools*` and `ext*` binds merged into one `extensions*` family.
- `define_tool` → `define_extension`.
- `docs/defined-tools.md` → `docs/extensions.md`, absorbing the package-side caveats.

**Out (deferred):** inheriting installed packages from root, package updates, an in-app
editor, rejected-extension memory, deep (transitive-dependency) package review.

## Terminology

The word "tool" is not being deleted — it is being demoted from a management surface.

- **Extension** — the unit you acquire, review, enable and revoke. One extension may
  register several tools, commands and skills.
- **Tool** — the unit an agent calls, and the unit a profile's `tools:` allowlist filters
  ([profiles.md](../../profiles.md)). Unchanged by this work.

This is why `define_tool` is misnamed today: it writes an extension module.

## What pi already does (verified, 2026-08-03)

Spikes drove the real `DefaultPackageManager` (pi-coding-agent 0.80.10) under Deno against
a throwaway `agentDir`. `PackageManager` already separates fetching from enabling, which is
the entire basis of the design:

| Need | Mechanism | Result |
|---|---|---|
| Fetch without enabling | `install(source)` | files land in `<agentDir>/npm/node_modules/<pkg>`; `listConfiguredPackages()` stays empty |
| Show what would run, pre-enable | `resolveExtensionSources([source])` | returns the exact entry files (`pi-crew/index.ts`) and skills for a package that is **not** configured |
| Enable | `addSourceToSettings(source)` | returns `true`; the package appears in `listConfiguredPackages()` |
| Disable, keeping files | `removeSourceFromSettings(source)` | drops it from the configured set; `getInstalledPath()` still resolves |
| Delete bytes | `remove(source)` | uninstalls without touching settings |

Three findings drive the design:

1. **No new "what runs" ledger is needed.** `settings.json` is the enabled record for
   packages exactly as file location is for loose modules. Both are read by pi itself, so
   neither can drift from reality — the property [defined-tools.md, now extensions.md](../../extensions.md)
   was built around survives the merge.
2. **A package can be reviewed as code.** `resolveExtensionSources` works on an installed-
   but-unconfigured source, so "read what will execute" is available for packages and not
   just loose modules. Without this, unifying the gate would have been cosmetic.
3. **Settings writes are queued.** `setPackages` → `save()` → `enqueueWrite`, so enabling is
   immediate in memory and the disk write lands shortly after. Already true of today's
   `installAndPersist`; sessions start later, so it is not a new risk — but it means
   "enable, then immediately read `settings.json`" races and must not be done.

A fourth, smaller finding: `normalizePackageSourceForSettings` rewrites a **local path**
source relative to `agentDir` (`/tmp/…/pkg` was stored as `../pkg`), so the string you
install with is not always the string you get back. See decision 6.

## Decisions

1. **One rule, both origins.** An extension runs iff it is in pi's own loading set; it is
   awaiting review iff there is a file for it in the scope's `pending/` dir. Neither half
   is a new ledger — one is what pi reads, the other is a directory listing.
2. **`pending/` holds both origins.** A pending loose module is `pending/<name>.ts`, as
   today. A pending package is `pending/<slug>.json` holding `{source, installedPath,
   requestedAt}`. Listing splits the dir by file extension. The quarantine dir stays a dir
   of files whose *presence* is the record, rather than becoming a list-shaped ledger with
   entries that can disagree with each other.
3. **A pending package is fetched, not merely named.** `install()` runs at request time, so
   review happens against bytes on disk rather than a source string. The cost is that
   rejecting a package means deleting something already downloaded, which is correct: the
   alternative is reviewing a promise.
4. **Review shows code for both origins.** Loose module → the file. Package → the entry
   files from `resolveExtensionSources`, read from disk and shown the same way. Expand-
   before-approve stays a hard requirement, since approving without looking is the failure
   mode the gate exists for.
5. **Revoke returns to `pending/`; it does not delete.** Symmetric across origins now that
   the package side has a files-stay-put off switch (`removeSourceFromSettings`). Deleting
   bytes is a separate, explicit action. Consequence, and the reason to prefer it:
   re-enabling something previously revoked requires re-review.
6. **A pending package's identity is its slug, not its source string.** The pending
   filename is `encodeURIComponent(source)` — reversible, filesystem-safe, no ledger. On
   enable, the pending file is removed **by the slug we already hold**, never by matching
   against `listConfiguredPackages()`, because pi normalizes local-path sources on the way
   into settings (fourth finding above).
7. **Compiled-in tools stay out of this.** `kanbanTools`, `profileAuthoringTools` and
   `define_extension` are pique's own, passed as `customTools`. They are not user-managed
   and do not appear in the list.
8. **Inheritance stays asymmetric, and says so.** Loose modules inherit from root via
   `additionalExtensionPaths`; packages do not, because routing package sources down that
   path is the operation implicated in the boot panic
   ([scopes.md](../../scopes.md) deferred #1). Merging the two into one list makes the
   asymmetry visible for the first time, so the Inherited group must state that packages
   are per-scope. Fixing it is out of scope here.
9. **`define_extension` replaces `define_tool`.** Same quarantine behaviour, truthful name,
   description updated to say it authors an extension that registers one or more tools.
   Agent-facing only — nothing on disk encodes the old name.

## Architecture

### On disk

Nothing moves. Both directories already carry the right names, and packages already in
`settings.json` are already enabled — there is no migration.

```
~/.pique/scopes/<root|ws-N>/agent/
  extensions/                 enabled loose modules — pi auto-discovers these
  pending/
    lookup_weather.ts         pending loose module
    npm%3Api-crew.json        pending package: {source, installedPath, requestedAt}
  settings.json               enabled packages — pi's own file
  npm/node_modules/…          fetched package bytes, enabled or not
```

### Lifecycle

| Step | Loose module | Package |
|---|---|---|
| Acquire | `define_extension` writes source | `pm.install(source)` — fetch only |
| Pending record | `pending/<name>.ts` | `pending/<slug>.json` |
| Review shows | the file | `resolveExtensionSources()` entry files |
| Enable | rename → `extensions/` | `pm.addSourceToSettings()`, then drop the pending file |
| Enabled record | file in `extensions/` | entry in `settings.json` |
| Revoke | rename → `pending/` | `pm.removeSourceFromSettings()` |
| Delete | `Deno.remove` | `pm.remove(source)` |

### Model

```ts
type Origin = "local" | "package";
type ExtState = "pending" | "enabled";
type Extension = {
  id: string;        // "local:<name>" | the package source — UI key, unique per scope
  name: string;      // display name
  origin: Origin;
  state: ExtState;
  scope: ScopeId;
  source?: string;   // packages only, as given
  path?: string;     // installedPath (package) or file path (local)
};
```

`listExtensions(scope)` merges `listConfiguredPackages()` with a scan of `extensions/` and
`pending/`. `listVisibleExtensions(scope)` adds ancestors' **local** extensions only, per
decision 8.

### Modules

| File | Change | Responsibility |
|---|---|---|
| `src/lib/extensions/paths.ts` | New (from `tools/paths.ts`) | `liveDir`, `pendingDir`, `livePath`, `pendingPath`, plus `pendingPackagePath` / slug encode-decode |
| `src/lib/extensions/local.ts` | New (from `tools/service.ts`) | loose-module listing, read, enable, revoke, delete; `inheritedExtensionFiles` unchanged |
| `src/lib/extensions/packages.ts` | New (from `chat/extensions.ts`) | per-scope `DefaultPackageManager`; `install` (fetch + write pending), `resolveEntryFiles`, `enable`, `revoke`, `delete`, `search` |
| `src/lib/extensions/service.ts` | New | the merged surface: `listExtensions`, `listVisibleExtensions`, `readExtension`, `enable`, `revoke`, `remove` — dispatching on `origin` |
| `src/lib/extensions/agent-tools.ts` | New (from `tools/agent-tools.ts`) | `define_extension`, scope-bound, writes into `pending/` only |
| `src/lib/extensions/bindings.ts` | New | frontend half of the `extensions*` contract, replacing `tools/bindings.ts` and the `ext*` half |
| `src/lib/tools/*`, `src/lib/chat/extensions.ts` | Delete | superseded by the above |
| `src/lib/chat/agent.ts` | Modify | import `toolAuthoringTools` → `extensionAuthoringTools`, `inheritedExtensionFiles` from its new home |
| `src/desktop.ts` | Modify | `tools*` + `ext*` binds → one `extensions*` family |
| `src/lib/settings/SettingsModal.svelte` | Modify | drop the `tools` section; rebuild `extensions` as Awaiting review / Enabled / Inherited, with origin badges and per-origin review panes |
| `docs/extensions.md` | New (from `defined-tools.md`) | the merged feature doc |
| `docs/scopes.md` | Modify | the Tools row and section become Extensions; deferred #1 restated |
| `docs/profiles.md` | Modify | references to `define_tool` and Settings → Tools |

### UI

One section, grouped by state rather than origin:

```
Awaiting review     source expanded before Approve enables — both origins
Enabled             packages and loose modules mixed, origin badge per row
Inherited from Root read-only; labelled "loose modules only — packages are per-scope"
```

Acquisition stays two inputs — the npm search box and the manual source field — but both
now land in Awaiting review instead of going live. The existing "Extensions run with full
system access" warning moves onto the review pane, where it is about code the user is
looking at rather than a string they typed.

## Verification

- `paths_test.ts` — slug encode/decode round-trips (`npm:@scope/pkg`, git URLs, local
  paths); a slug can never escape `pending/`; existing tool-name rules preserved.
- `local_test.ts` — the current `tools/service_test.ts` cases, plus revoke landing back in
  `pending/` rather than deleting.
- `packages_test.ts` — the pure helpers already covered by `chat/extensions_test.ts`
  (`isValidSource`, `npmSearchUrl`, `toExtInfo`, `toSearchResult`).
- `service_test.ts` — the merged listing: both origins in one list, correct state grouping,
  inheritance including only ancestors' local extensions.
- `integration_test.ts` — the claim the feature exists to make, driven through the real
  `DefaultPackageManager` against a temp `agentDir`, **network-free** by using a local-path
  package source (spike-verified: `install` → `resolveExtensionSources` → `addSourceToSettings`
  all work on a local dir). Assert that a pending package resolves entry files but does not
  appear in `listConfiguredPackages()`, and that enabling flips exactly that.

## Deferred

1. **Inheriting installed packages from root.** Per decision 8 and
   [scopes.md](../../scopes.md) deferred #1 — still blocked on re-testing the npm-package
   boot panic under the webview binary, not on this design.
2. **Deep package review.** The reviewer reads entry files, not transitive npm
   dependencies. Materially better than approving a source string; not an audit. The UI
   must not imply otherwise.
3. **Package updates.** `checkForAvailableUpdates()` and `update()` exist and are unused.
   An "update available" affordance is a natural follow-up, and under decision 5 an update
   arguably belongs back in review.
4. **Enforcing the gate.** Unchanged by this work: an agent with `bash`/`write`/`edit` can
   still write straight into `extensions/`. Containment is a profile
   ([profiles.md](../../profiles.md)); see `defined-tools.md` deferred #1 for the
   `tool_call` interception sketch.
5. **Live reload into running sessions.** Enable and revoke still take effect only in Chat
   modules opened afterwards, for both origins now. `defined-tools.md` deferred #2.
6. **In-app authoring.** `defined-tools.md` deferred #6.
7. **Rejected-extension memory.** `defined-tools.md` deferred #7, now applying to packages
   too — rejecting a package deletes the fetched bytes and records nothing.

---

## Deviations found during implementation

1. **A local-path package source does not round-trip.** The spike behind the fourth
   finding said it did; the integration test proved otherwise. pi resolves a *stored*
   local source against `agentDir` but a *supplied* one against `cwd`, so revoke matched
   nothing and returned `false` silently. `packages.ts` now canonicalizes local sources
   to absolute paths on the way out of `listEnabledPackages`. Recorded as Known broken #3
   in the feature doc.
2. **The fetch confirm stayed.** Decision 3 moved the trust warning onto the review pane,
   but `npm install` runs a package's lifecycle scripts at fetch time — before review is
   possible. Downloading therefore keeps its own confirm, now worded as "Download this
   package?". Known broken #1.
3. **The manager cache is keyed by `agentDir`, not scope id.** Keying by scope alone
   handed back a manager pointing at a stale tree whenever `$HOME` changed, which the
   tests do on every case.
