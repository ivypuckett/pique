# Automatons

An **automaton** is a named agent that runs without a conversation. It is one
markdown file naming a prompt template to send plus the exact extensions and
skills its run may load, and it is launched by a button in the Automatons
module.

A Chat module is a thread you tend. An automaton is a job. The two ask different
questions — a chat asks "what did it say", a run asks "did it finish, and what
did it do" — which is why the runs live in a list rather than a transcript.

## The file

```
~/.pique/scopes/<root|ws-N>/automatons/triage.md
```

```markdown
---
description: Sorts new cards into columns and comments its reasoning.
prompt: daily-triage
extensions: [pique:kanban, kanban_notes, npm:pi-crew]
skills: [changelog-style]
model: anthropic/claude-opus-4
---
```

The filename minus `.md` is the name — there is no `name:` key, so the two can
never disagree. Names match `/^[a-z0-9][a-z0-9-]*$/`; a file whose basename does
not is skipped rather than breaking the listing.

`prompt:` is **required**. `description:`, `extensions:`, `skills:` and `model:`
are optional. Unknown keys are ignored.

### `prompt:` is what runs. The body is reserved.

The file's body is **never sent to a model**. What runs is the prompt template
`prompt:` names, invoked as if you had typed `/daily-triage` in a chat.

A body is retained when the file is read, so nothing is lost by listing or
launching one — but the editor has no field for it and never writes one back, so
saving through the form drops whatever a hand-written file had there.

This is deliberate. pique had a "profile" concept that carried its own prompt
body, and it was removed on 2026-08-03 precisely because it duplicated the
prompt-template mechanism. An automaton references that one artifact instead of
becoming a second one — so a template stays reviewable, quarantinable, invocable
by hand, and reusable by several automatons.

The cost is real: creating an automaton means writing two files. That only pays
off if templates get reused.

### Arguments

The Launch button has an argument box beside it. Whatever you type is appended,
so the run's first message is `/daily-triage <your text>` and the template's own
`$1`/`$@` substitution does the rest — see [prompts.md](prompts.md). No new
mechanism, which is also how a kanban card will hand over its title when that
trigger lands.

### `model:` pins which model runs it

`model:` is `provider/model-id` — the same pair the Chat module's picker writes,
and the same pair `~/.pi/agent/models.json` uses. The run uses that model no
matter what the workspace's chat is later switched to — which is the point: a
job that was tuned against one model should not silently change model because
somebody moved a picker in another tab.

The editor's picker lists every model the connected providers serve and has no
"inherit" entry: a definition with no `model:` yet opens on the scope's chat
default, so what the picker shows is always the model the run will use, and
saving writes it out. Editing an older automaton through the form therefore pins
whatever it was already running on.

A hand-written file may still omit `model:`, and then the run takes the scope's
chat default at launch — what every automaton did before the key existed.

Only the first `/` separates the halves. Provider ids never contain one; model
ids routinely do (`lmstudio/google/gemma-4-e4b` is a provider and a model, not
three parts). A value that is not two non-empty halves is rejected when the file
is read, alongside a missing `prompt:`.

**There is no fallback.** A `model:` no connected provider serves refuses the
launch with `model unavailable: <ref>` — unlike Chat, which quietly drops to a
compiled-in default. A run that used a model other than the one its file names
would be discovered long after it finished.

The thinking level still comes from the scope for every run; see Deferred #4.

## The capability set

`extensions:` and `skills:` are the whole of what a run loads. An automaton
naming nothing gets **zero** extensions — not "the defaults" — and inherits
nothing from what the workspace enabled for its chat agent.

That is the point of the feature. A run is reproducible, and reading the file
tells you what it can reach.

Mechanically, the run's resource loader is built with `noExtensions: true` and
`noSkills: true`, which makes the loaded sets exactly the paths pique hands it.
This **composes** the set rather than filtering one that already loaded.

Three kinds of thing can be named in `extensions:`:

| Entry           | Means                                                |
| --------------- | ---------------------------------------------------- |
| `pique:<group>` | one of pique's compiled-in tool groups               |
| a bare name     | a local extension enabled in this scope or inherited |
| anything else   | a package source, which must already be enabled here |

The three built-in groups are `pique:kanban`, `pique:extension-authoring` and
`pique:prompt-authoring`. Nothing is injected — an automaton gets a group only
by naming it. The `pique:` prefix cannot collide with a local extension name,
which may not contain a colon.

**Naming a package brings its skills too.** A package's own skills arrive with
it regardless of `noSkills`, which is the only way a skills-only package can
work at all (see [extensions.md](extensions.md)). `skills:` is for a scope's own
loose skills, not for packages'.

### It is not a sandbox

`noExtensions` and `noSkills` govern extension- and skill-provided capability
only. pi's builtins — `read`, `write`, `edit`, `bash`, `grep` — are present in
every run regardless of what the file names.

**An automaton that cannot modify the filesystem is not expressible.** If you
need that, it does not exist yet; see [extensions.md](extensions.md) Deferred
#1. Do not read an automaton's short `extensions:` list as confinement.

### An unresolvable reference refuses the launch

A named extension, package or skill that resolves to nothing raises **before any
session is created**. The run is recorded `failed` with the offending name, and
nothing runs.

This is deliberate and is the one behaviour that should not be softened. The old
profile mechanism ignored unknown names silently, and a typo simply disappeared.
An automaton runs unattended, where a run that quietly does less than its file
says is worse than one that does not start. A `prompt:` naming no existing
template is refused the same way.

Only **enabled** extensions are nameable. A module awaiting review in
`pending/`, or a package that has been fetched but not enabled, is rejected — so
an automaton cannot be a way around the review gate in Library → Extensions.

## Skills

Skills are listed and nameable but have no lifecycle: no install, no review, no
quarantine. A skill is markdown a model reads, not code that executes, so the
gate that exists for extensions does not apply.

A scope's skills live in `~/.pique/scopes/<id>/agent/skills/`, either as
`<name>/SKILL.md` or as a loose `<name>.md`, and they inherit from root the way
everything else does. Library → Skills shows what is nameable.

**A skill is named by its path basename**, not by the `name:` in its
frontmatter. Resolving by frontmatter would mean parsing every skill on every
launch. When the two disagree, Library → Skills says so, because otherwise the
mismatch surfaces as a puzzling "skill not found" at launch time.

## Runs

```
~/.pique/scopes/<id>/automatons/
  runs/<id>.json     the record: status, timings, trigger, model, error
  sessions/          pi session JSONL — the transcript
```

A run is `running`, then `done`, `failed` or `stopped`. The record is what makes
yesterday's runs listable; the JSONL is the transcript you read by clicking one.

Every record also carries the `model` the run actually used, resolved at launch
and shown on the run. Reading it off the automaton instead would answer with
whatever the scope's default is _today_, which is not necessarily what produced
last week's transcript.

Every record carries a `trigger`, which is `manual` today. It exists now so the
shape does not change when card-move and cron triggers land, and so "why did
this fire?" stays answerable.

Stop is available while a run is `running`. There is no turn or wall-clock cap:
any number would be arbitrary, and an automaton killed mid-edit is worse than
one running long in a list you are watching. That calculus changes when runs
start firing unattended.

### Runs do not survive quitting pique

A run lives in the app's memory, so closing pique ends it. Any record left
`running` is repaired to `failed` with "interrupted by shutdown" at the next
start, rather than leaving a row that would never change.

## Scope

Automatons inherit like everything else: root's are launchable from every
workspace, a workspace can add its own, and a same-named local one shadows
root's. See [scopes.md](scopes.md).

Two things always belong to the **launching** scope, even when the definition
was inherited from root: the run and its record, and everything the run resolves
against — base prompt, kanban board, working directory, and the model unless the
file pins one.

One asymmetry worth knowing: packages are not inherited. An automaton in root
that names a package therefore only launches from a scope where that package is
enabled.

## Deferred

### 1. Card-move and cron triggers

The reason the feature exists, and deliberately not in the first cut. Both are
callers of the same `launchAutomaton` entry point the button uses. What neither
has yet is a decision about re-entrancy: whether a card moved twice launches
twice, and whether a schedule fires while the previous run is still going.

### 2. `define_automaton`

There is no agent-facing tool for authoring one, and `automatons/pending/`
exists unused, ready for it. An automaton grants no capability its scope has not
already approved, but it does create an unattended runner, which is worth a
human reading first.

### 3. Restricting pi's builtins

Per above, `read`/`write`/`edit`/`bash` are always present.
`session.setActiveToolsByName()` is the mechanism and would layer onto the
capability set cleanly.

### 4. Per-automaton thinking level and base prompt

`model:` landed; these two did not. A run's thinking level still comes from the
scope's chat defaults and its system prompt from the scope's `agent/SYSTEM.md`.
Both are the same shape of addition as `model:` — a frontmatter key read in
`launchAutomaton` — and neither has come up in practice yet.

### 5. Run retention

Nothing prunes `runs/`. Fine for a button; a schedule would grow it without
bound.

### 6. Concurrency

Nothing limits how many runs go at once, and they share one model runtime.
