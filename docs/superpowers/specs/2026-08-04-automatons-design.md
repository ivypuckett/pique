# Automatons — Design

**Date:** 2026-08-04 **Status:** Designed

## Purpose

Let a human define an **automaton**: a named, launchable agent that is a prompt
template plus an explicit set of extensions and skills, and that runs to
completion without a conversation. A button launches one today; a card reaching
a column and a cron schedule launch the same one later.

A Chat module is a thread a human tends. An automaton is a job. The two need
different surfaces because the questions differ: a chat asks "what did it say",
a run asks "did it finish, and what did it do".

## Scope

**In:**

- A new module kind, `automatons`, listing the automatons visible in a scope and
  the recent runs of each.
- One markdown file per automaton, per scope, inherited along `chain()`.
- An explicit capability set — the extensions and skills a run loads, and
  nothing else.
- A form editor, because every field is a choice from a list pique can produce.
- Run records that survive an app restart, and a transcript per run.
- A read-only **Skills** sub-tab in Library, so what is nameable is visible.
- A single `launchAutomaton()` entry point, so later triggers add a caller
  rather than a mechanism.

**Out (deferred, with reasons below):** kanban-move and cron triggers; agent
authoring (`define_automaton`); per-automaton model, thinking level or base
prompt; turn and wall-clock caps; runs that outlive the app.

## What pi already does (verified, 2026-08-04, SDK 0.83)

Read out of the installed SDK rather than assumed. Every claim below is what
makes a decision in the next section possible.

| Need                 | Mechanism                                                   | Result                                                                              |
| -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Exact extension set  | `DefaultResourceLoader({ noExtensions: true })`             | loaded set becomes exactly `additionalExtensionPaths`                               |
| Exact skill set      | `DefaultResourceLoader({ noSkills: true })`                 | loaded set becomes exactly `additionalSkillPaths` (plus named packages' own skills) |
| Skills by path       | `additionalSkillPaths`                                      | takes files **or** directories, unlike `additionalExtensionPaths`                   |
| Mixed extension refs | `resolveExtensionSources(paths, { temporary: true })`       | each entry is a package source, so file paths and `npm:` sources both work          |
| Post-load reshaping  | `extensionsOverride` / `skillsOverride` / `promptsOverride` | present, and deliberately unused here (decision 6)                                  |

Four findings drive the design:

1. **This composes rather than filters.** `noExtensions` selects what is
   _loaded_; the deleted profile allowlist filtered the tool registry after the
   fact. A capability an automaton does not name is never constructed, so there
   is nothing for a later `setActiveToolsByName` to re-widen.
2. **It is not containment.** `noExtensions` and `noSkills` govern extension-
   and skill-provided capability only. pi's builtins — `read`, `write`, `edit`,
   `bash`, `grep` — are in every session regardless. A run that cannot write to
   disk is **not expressible** by this design. Recorded in
   [extensions.md](../../extensions.md) Deferred #1 as well, because the gap
   predates automatons.
3. **A named package brings its skills with it.** With `noSkills: true`, the
   loader still merges `cliEnabledSkills` — the skills shipped _by_ the packages
   named in `additionalExtensionPaths`. Naming `npm:pi-crew` in `extensions:`
   therefore grants its skills too, which is the only way a skills-only package
   (see [extensions.md](../../extensions.md)) can work at all. The `skills:`
   field is for a scope's own loose skills, not for packages'.
4. **`includeDefaults` is already always `false`.** `DefaultResourceLoader`
   passes it that way for skills and prompts alike, so `<agentDir>/skills` and
   `<cwd>/.pi/skills` never auto-scan into a loader-built session. They reach a
   normal chat session through the package manager's own directory collection,
   which `noSkills` is what excludes.

## Decisions

1. **An automaton references a prompt template; it does not carry one.**
   `prompt: daily-triage` names a template in the scope's `agent/prompts/`. The
   prompt stays one authored artifact — reviewable, quarantinable, invocable as
   `/daily-triage` by hand, reusable by several automatons. A second
   markdown-with-frontmatter prompt artifact is exactly what
   [2026-08-03-collapse-profiles](../plans/2026-08-03-collapse-profiles.md)
   removed a day earlier, and reintroducing one under a new name would undo that
   for no gain. The **cost is real**: authoring an automaton touches two files,
   and that only pays off if templates get reused.
2. **The body is ignored, and the docs say so.** A file's body is reserved. Not
   silently tolerated — the parser keeps it and the editor never writes it, so
   the meaning of `prompt:` can never be ambiguous. This is what makes decision
   1 enforceable rather than merely conventional.
3. **The capability set is exactly what is named.** `noExtensions: true` and
   `noSkills: true` on every run. An automaton naming no extensions gets
   **zero** extensions, not "the defaults", and does not inherit what the
   workspace enabled for chat. This is the whole reason the feature is worth
   building: a run is reproducible, and reading the file tells you what it can
   reach.
4. **pique's compiled-in tool groups are named the same way as everything
   else.** Reserved `pique:`-prefixed entries in the same `extensions:` list —
   `pique:kanban`, `pique:extension-authoring`, `pique:prompt-authoring`.
   Nothing is injected; a group is present iff it is named. The prefix cannot
   collide with a local extension name by construction, because those match
   `/^[a-z][a-z0-9_]*$/`, which admits no colon.
5. **An unresolvable reference fails the launch.** A named extension or skill
   that resolves to nothing raises before the session is created, and the run is
   recorded `failed` with the offending name. Profiles silently ignored unknown
   tool names —
   [2026-07-28-agent-profiles-design](2026-07-28-agent-profiles-design.md)
   decision 6 made it a feature, and its Deferred #2 admits a typo "disappears
   silently". An unattended runner cannot afford that: a run that quietly does
   less than its file says is worse than one that does not start.
6. **The `*Override` hooks stay unused.** They would let pique reshape the
   loaded set arbitrarily, which is a second mechanism doing the first one's
   job. Path selection is sufficient for every case here.
7. **The scope's `agent/SYSTEM.md` still applies.** An automaton runs _as_ that
   workspace's agent, unattended; the base prompt is where "this workspace is a
   Rust project" lives. Per-automaton override is deferred.
8. **Prompt templates are not restricted.** `noPromptTemplates` stays off and
   the scope's prompt dirs are passed, because that is how `prompt:` resolves —
   the run's first message is `/<name> $@` and pi's own expander does the rest.
   Restricting which templates a run can see would buy nothing: it sends exactly
   one.
9. **Launch arguments ride the template's existing substitution.** A text input
   beside the button, passed as `$@`. No new mechanism, and it is already how a
   kanban card will hand over its title.
10. **`trigger` is recorded from the first run.** `"manual"` today,
    `"kanban"`/`"cron"` later. The field exists now so the record shape does not
    change when triggers land, and so "why did this fire?" stays answerable.
11. **Stop, but no cap.** Each running row gets a stop button calling
    `session.abort()`, as chat's does. A turn or wall-clock cap is the obvious
    runaway guard, but any number chosen now is arbitrary, and an automaton
    killed mid-edit is worse than one running long in a list a human is
    watching. Revisit when cron lands and runs fire unattended.
12. **Skills get a listing, not a lifecycle.** `<agentDir>/skills` is already
    pi's own location and already reaches chat sessions. This work adds a
    chain-resolved listing and a read-only Library sub-tab so a skill can be
    named and seen — not install, enable, review or quarantine. Skills are
    markdown read by a model, not code that executes; the extension review gate
    exists for the latter.

## Architecture

### On disk

```
~/.pique/scopes/<root|ws-N>/
  automatons/
    triage.md            live — launchable
    pending/             quarantine; reserved, nothing writes here in v1
    sessions/            pi session JSONL, one file per run — the transcript
    runs/<runId>.json    the run record
  agent/
    skills/              nameable skills for this scope (pi's own location)
    prompts/             where `prompt:` resolves
```

`automatons/` sits outside `agent/` for the same reason profiles did: pi
auto-discovers inside an `agentDir`, and a directory of markdown there invites
it to interpret the files. `agent/skills/` is inside for the opposite reason —
pi's discovery there is exactly what is wanted.

`pending/` exists in v1 only so the live listing can glob `automatons/*.md`
without recursion from the start. Nothing writes into it until
`define_automaton` lands (Deferred #2).

### File format

```markdown
---
description: Sorts new cards into columns and comments its reasoning.
prompt: daily-triage
extensions: [pique:kanban, kanban_notes, npm:pi-crew]
skills: [changelog-style]
---
```

The filename minus `.md` is the name — no `name:` key that could disagree.
Basenames match `/^[a-z0-9][a-z0-9-]*$/`, and a file that does not is skipped
rather than raising, because the directory is user-editable. `prompt:` is
required; `extensions:`, `skills:` and `description:` are optional and default
to empty. Unknown keys are ignored, as pi is with skills. Parsed with
`jsr:@std/front-matter@^1/yaml`, already a dependency.

### Resolution

`resolveExtensionRefs(scope, refs)` maps each entry to one of three things:

| Ref shape       | Resolves to                                             | Source                         |
| --------------- | ------------------------------------------------------- | ------------------------------ |
| `pique:<group>` | a `customTools` array                                   | compiled in                    |
| `<name>`        | an absolute `.ts` path, nearest scope on `chain()` wins | `extensions/local.ts`          |
| anything else   | passed through as a package source                      | pi's `resolveExtensionSources` |

Local names are looked up against each scope's live `extensions/` dir only — a
revoked or pending extension is not nameable, which keeps the review gate
meaningful. `resolveSkillRefs` is the same walk over `agent/skills/`, returning
directories or files as pi's `additionalSkillPaths` accepts either.

**A skill is named by its path basename**, not by the `name:` in its `SKILL.md`
frontmatter: `changelog-style` resolves `agent/skills/changelog-style/` or
`agent/skills/changelog-style.md`. Resolving by frontmatter name would mean
parsing every skill on every launch to find one, and pi re-derives the name
itself once the path is handed over. The two can disagree — a skill whose
frontmatter renames it is still named here by its basename, and the Library
listing shows both so the mismatch is visible rather than mysterious.

### The run

```ts
launchAutomaton(scope, name, args) → runId
```

One function. The button calls it; a kanban hook and a cron call the same one.
That seam is the main thing this work owes the future.

It builds a `DefaultResourceLoader` with `noExtensions`/`noSkills` set and the
resolved paths, calls `createAgentSession` with the resolved `customTools`
groups and a `SessionManager` rooted at `automatons/sessions/`, subscribes, and
prompts `/<template> <args>`. Events buffer into a per-run queue drained by
long-poll, exactly as `chat/agent.ts` does — `session.prompt()` already runs
independently of whether anyone is draining, so an unattended run needs no new
machinery.

A live run is an entry in an in-memory `Map`. The sidecar `runs/<runId>.json` —
`{ automaton, status, startedAt, endedAt, error?, trigger }`, status one of
`running | done | failed | stopped` — is what makes yesterday's runs listable
after a restart.

**Runs die with the app.** Quitting pique mid-run leaves a `running` sidecar
that describes nothing. Startup reconciles those to `failed` with an explicit
"interrupted by shutdown" error rather than leaving a row that will never
change. Out-of-process runs that survive are Deferred #5.

### Modules

| File                                   | Change | Responsibility                                                                                      |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `src/lib/automatons/paths.ts`          | New    | Every path keyed by scope; `assertAutomatonName`; `ensureAutomatonDirs`                             |
| `src/lib/automatons/parse.ts`          | New    | Pure `parseAutomaton(name, text) → AutomatonDef`; no filesystem                                     |
| `src/lib/automatons/service.ts`        | New    | `listAutomatons` / `listVisible` / `read` / `write` / `remove`, and `resolveAutomaton` on `chain()` |
| `src/lib/automatons/resolve.ts`        | New    | Refs → loader paths and `customTools` groups; raises on an unresolvable ref                         |
| `src/lib/automatons/run.ts`            | New    | `launchAutomaton` / `readRun` / `stopRun` / `listRuns` / `runHistory` / `reconcileRuns`             |
| `src/lib/automatons/bindings.ts`       | New    | Frontend half of the `automaton*` binding contract                                                  |
| `src/lib/automatons/Automatons.svelte` | New    | The module: list, launch, run rows, transcript, form editor                                         |
| `src/lib/skills/paths.ts`              | New    | `skillsDir(scope)`                                                                                  |
| `src/lib/skills/service.ts`            | New    | `listVisibleSkills(scope)` along `chain()`, for the picker and the Library tab                      |
| `src/lib/skills/Skills.svelte`         | New    | Read-only list, in the shape of the other Library sections                                          |
| `src/lib/library/Library.svelte`       | Modify | A third sub-tab                                                                                     |
| `src/lib/modules/registry.ts`          | Modify | Register `automatons`                                                                               |
| `src/desktop.ts`                       | Modify | `automaton*` and `skills*` `win.bind` handlers, and `reconcileRuns` at startup                      |
| `src/lib/layout_test.ts`               | Modify | Pin `moduleLabel("automatons")`                                                                     |
| `docs/automatons.md`                   | New    | The feature doc, in the shape of `prompts.md`                                                       |
| `docs/scopes.md`                       | Modify | Inheritance rows for automatons and skills                                                          |
| `README.md`                            | Modify | Module list, and the Agent Structure glossary                                                       |

`layout.ts` needs no change: `moduleLabel("automatons")` already yields
"Automatons" via its capitalize fallback. `TabStrip.svelte` needs none either —
it offers every registry key except `chat` and `filetree`.

**Every bind must be registered before the first top-level `await` in
`desktop.ts`.** `reconcileRuns` is startup work and must not be awaited among
them.

### The module surface

```
┌──────────────────────────────┬────────────────────────────────┐
│ [Root|WS-2]              [+] │                                │
│                              │   run transcript, or the       │
│ ▸ triage          [Launch]   │   form editor for a definition │
│     ● running   0:42         │                                │
│     ✓ done      2h ago       │                                │
│ ▸ changelog       [Launch]   │                                │
│   (inherited from root)      │                                │
└──────────────────────────────┴────────────────────────────────┘
```

Scope is owned by the module instance — `workspaceId` prop plus a local
root/workspace toggle, hidden when the workspace _is_ root — following
`Kanban.svelte` and `Library.svelte`. Two Automatons tabs in two workspaces must
not fight over one store.

The editor is a **form, not a textarea**, diverging from Prompts deliberately. A
template's content is prose, so a textarea is right there; an automaton's
content is four references, and a textarea invites the typos that decision 5
turns into launch failures. Every field is a choice from a list pique can
already produce.

A run's transcript reuses chat's `toHistory` projection over the session's
messages, so a live run and a finished one render identically.

## Verification

Services and resolvers get `deno test`; the UI is verified manually per
[agent-verification.md](../../agent-verification.md), as the repo has no Svelte
component tests.

- `parse_test.ts` — frontmatter present/absent/malformed, missing `prompt:`,
  empty vs absent `extensions:`, unknown keys ignored, bad name skipped, body
  retained and never interpreted.
- `service_test.ts` — inheritance and shadowing across `chain()`, `pending/`
  never listed as live.
- `resolve_test.ts` — `pique:` groups map to tool groups; a local name resolves
  to the nearest scope's live path; a package source passes through untouched; a
  pending or revoked extension is **not** nameable; **an unresolvable ref
  raises** (decision 5).
- `run_test.ts` — record lifecycle and `reconcileRuns` turning a stranded
  `running` into `failed`.
- `run_integration_test.ts` — the claim the feature exists to make, in the shape
  of `chat/scope_integration_test.ts`: launch an automaton naming exactly one
  extension and assert through `activeToolNames` that its tool is present **and
  that an extension enabled in the scope but not named is absent**. That single
  assertion is what proves `noExtensions` composes rather than filters; without
  it the whole design is unverified.
- `deno task test` and `deno task build` clean.
- Manual, desktop (`deno task dev`) — the only surface where runs work: create
  an automaton in the form, launch it, watch a run go `running → done`, open its
  transcript, stop a second one mid-flight, quit mid-run and confirm the
  stranded record reconciles to `failed` on restart.
- Manual, web — the module shows the desktop-only placeholder, as Chat and
  Terminal do.

## Deferred

1. **Kanban-move and cron triggers.** The point of the feature, and deliberately
   not in the first cut. Both are callers of `launchAutomaton`; what neither has
   yet is a decision about re-entrancy — whether a card moved twice launches
   twice, and whether a cron fires while the previous run is still going.
2. **`define_automaton`.** `pending/` is built for it. An automaton grants no
   capability its scope has not already approved (decision 3 selects from the
   enabled set), but it does create an unattended runner, which is worth a human
   read before it exists.
3. **Restricting builtins.** Finding 2: `read`/`write`/`edit`/`bash` are always
   present, so "an automaton that cannot modify the filesystem" is not
   expressible. `session.setActiveToolsByName()` is the mechanism and would
   layer on top of the capability set cleanly. Any UI built before then must
   avoid language ("sandboxed", "restricted") that claims otherwise.
4. **Per-automaton model, thinking level and base prompt.** A natural
   frontmatter extension, omitted until the prompt/extensions/skills triple is
   proven.
5. **Runs that outlive the app.** Would mean spawning the `pi` CLI per run
   instead of the in-process SDK. Real isolation, but the shared `ModelRuntime`
   is what makes Settings → Providers take effect without a restart, and a
   subprocess would not see it. Revisit only if cron makes it necessary.
6. **Turn and wall-clock caps.** Decision 11.
7. **A skill lifecycle.** Decision 12 gives skills a listing only. Install,
   review and quarantine would follow the extension shape if a reason appears.
8. **Concurrency limits.** Nothing stops ten simultaneous runs sharing one
   `ModelRuntime`. Fine for a button, plausibly not for cron.
