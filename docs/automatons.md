# Automatons

An **automaton** is a named agent that runs without a conversation. It is one
markdown file naming a prompt template to send plus the exact extensions and
skills its run may load, and it is launched by a button in the Automatons
module, by a `cron:` schedule of its own, or by a card arriving in a board
column.

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
tools: [read, grep]
model: anthropic/claude-opus-4
cron: "0 9 * * 1-5"
kanban: Inbox
wip: 3
---
```

The filename minus `.md` is the name — there is no `name:` key, so the two can
never disagree. Names match `/^[a-z0-9][a-z0-9-]*$/`; a file whose basename does
not is skipped rather than breaking the listing.

`prompt:` is **required**. `description:`, `extensions:`, `skills:`, `tools:`,
`model:`, `cron:`, `kanban:` and `wip:` are optional. Unknown keys are ignored.

### `tools:` withholds pi's builtins

`extensions:` says what capability a run gains. `tools:` says which of pi's own
builtins — `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls` — it keeps.
**Absent and empty are different:** no key at all means every builtin, the
behaviour of every automaton written before the key existed, while `tools: []`
means none of them, leaving a run that can call only what its extensions gave
it.

It restricts builtins **only**. Naming an extension's tool here is an error, not
a way to filter the capability set — `extensions:` governs that, and nothing in
`tools:` can widen or narrow it. A name that is not a builtin refuses the
launch, on the same terms as every other unresolvable reference below.

Two mechanics worth knowing, both in `run.ts`:

- It is implemented as pi's **denylist**, not its allowlist. `allowedToolNames`
  filters extension tools and `pique:` groups too, so `tools: [read]` under an
  allowlist would silently strip everything `extensions:` had just resolved —
  precisely the silent underdelivery this feature set is built to prevent.
- Excluding is not sufficient on its own. pi's default ACTIVE set is
  `[read, bash, edit, write]`; `grep`, `find` and `ls` are registered but
  inactive, so a run naming `grep` would exclude the rest and still not get it.
  The named builtins are therefore activated explicitly after session creation.

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
mechanism, which is also how a kanban card hands over its id and its title; see
`kanban:` below.

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

The thinking level still comes from the scope for every run; see Deferred #3.

### `cron:` fires it without a button

`cron:` is a five-field expression in **this machine's local time**: minute,
hour, day-of-month, month, day-of-week. No key means the Launch button is the
only way it runs, which is what every automaton did before the key existed.

`*`, `5`, `1-5`, `*/15` and `9-17/2` are all accepted, in comma-separated lists.
Names (`mon`, `jan`), `@daily`, seconds and `L`/`W`/`#` are not: each is a
second syntax to explain for a schedule nobody has asked for yet. A restricted
day-of-month **and** day-of-week are OR'd, as Vixie cron does — `0 8 1 * 1` is
"the 1st, and every Monday", not "the 1st if it is a Monday".

An expression that does not parse is an error on the whole definition, alongside
a missing `prompt:` and a malformed `model:`. It makes the automaton
unlaunchable until fixed, which is deliberate: a file claiming to run daily that
silently never does is the failure this format keeps refusing to ship. The
editor checks the field as you type, so a broken one is not written in the first
place.

Four things the schedule does **not** do:

- **It is not inherited.** An automaton is launchable from every scope that
  inherits it; its schedule fires only in the scope whose directory holds the
  file. Otherwise one `cron:` in root would fire a run per open workspace every
  time it came round, each in a different directory. The list shows an inherited
  automaton's schedule, greyed by the same "inherited" badge — it says what that
  file does where it lives, not what will happen here.
- **It does not fire while the previous run is going.** A fire arriving with
  that automaton still running in that scope is dropped, not queued: a job that
  takes longer than its interval would otherwise stack sessions against one
  shared model runtime. Nothing is recorded, because nothing ran — the drop is
  logged and the next fire is simply the next one that matches.
- **It does not catch up.** A minute that passed while pique was closed, or
  while the laptop was asleep, is gone. There is no last-fired state on disk and
  no burst of runs at startup. A schedule is a statement about when pique is
  running.
- **It does not fire for a closed workspace.** The scheduler walks the scopes in
  the saved layout, not the directories under `~/.pique/scopes/` — closing a
  workspace leaves its directory behind, and firing runs into a workspace the
  user thinks is gone is the wrong surprise.

Mechanically it is `automatons/schedule.ts`: a 20-second timer that evaluates
each **minute** exactly once and calls the same `launchAutomaton` the button
does, with `trigger: "cron"`. It adds a caller, not a mechanism — which was the
whole point of that seam.

### `kanban:` fires it when a card arrives

```yaml
kanban: "In Progress"
wip: 3
```

`kanban:` names one column of a board by **name**, matched after trimming and
lowercasing both sides. No key means no card ever fires it, which is what every
automaton did before the key existed.

An id would survive a rename and a name does not, but a column id is a UUID:
nobody hand-writes one, and a file holding one cannot be read to find out what
it does. Readability wins, as it does for every other key in this format. The
cost is that renaming a column stops the trigger — so the Automatons list flags
a `kanban:` matching no column on the board, in red, rather than leaving a file
that quietly never fires. The list and the dispatcher answer with the same
`automatons/column.ts`, so a badge can never call a working trigger broken.

**Arrival is entering the column.** A card moved in fires it, and a card created
there fires it — one typed straight into a column has arrived as surely as one
dragged in. Nothing else does: not a reorder within the column, not a metadata
or connection edit, and not a move onto the column the card is already in.
Firing on those would relaunch a job because somebody fixed a typo in a title.

**A human's move and an agent's move are the same event.** That is deliberate: a
triage automaton sorting cards into a column a worker automaton watches is the
workflow this exists for, and filtering to human moves would kill it.

It follows that **two automatons can pass a card back and forth indefinitely**.
The per-card guard below does not stop it — each run ends before the next
begins, so no guard ever sees two at once, and every hop is a real arrival.
There is no chain-depth cap and no loop detection: nothing bounds it but the
person reading the run list. A pair of automatons that move cards into each
other's columns is worth reading twice before saving.

Two guards, and no others:

- **The same card, already running under that automaton, is dropped.** The card
  is being worked; a second run would duplicate that rather than continue it.
  Different cards do not block each other — this is deliberately not cron's
  one-at-a-time rule, because a card carries an identity a schedule does not.
- **A fire over `wip:` is queued, not dropped.** A schedule comes round again; a
  card does not. The queue dedupes by card, so it cannot grow past the board,
  and when a run ends the next card is re-checked before it starts: one that has
  since left the column, or been deleted, is dropped rather than worked late.
  Not waiting for it is the whole point of having waited.

`wip:` is a whole number of 1 or more — the most runs of this automaton that may
be live in one scope at once. **Absent means unlimited**, because a compiled-in
default would be an arbitrary number and unlimited is what "a run per card"
plainly means. A value that is not a usable limit is an error on the whole
definition, alongside a malformed `cron:` or `model:`. It holds card fires only:
the Launch button and a `cron:` are never held.

The queue lives in memory, so **it dies with the app**, as the runs themselves
do. Cards waiting for a slot when pique closes are not waiting at the next
start, and nothing on the board records that they ever were. See Deferred #6.

**The trigger does not inherit**, for cron's reason: a board fires the
definitions its own scope holds and never the ones that scope inherits, or one
`kanban:` in root would fire a run per open workspace on every arrival. It
follows that a workspace dropping a card into a column of root's shared board
fires **root's** automaton, in root's directory — the board that fired is the
board that decides. A scope missing from the saved layout does not fire at all,
on the same terms as a schedule: closing a workspace leaves its board file
behind.

The run's first message is `/<template> <card-id> "<title>"`, so `$1` is the id
the `pique:kanban` tools address the card by and `$2` is the title for prose,
quoted so a multi-word one stays a single positional. No new mechanism — it is
the argument box above, typed by the dispatcher instead of by a human.

Mechanically it is `automatons/kanban.ts`, reached from the one point in
`board.ts` that announces an arrival, so every caller of the board fires the
trigger by construction. Like the scheduler it adds a caller, not a mechanism:
the same `launchAutomaton`, with `trigger: "kanban"` and the card recorded on
the run.

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

### It is still not a sandbox

`noExtensions` and `noSkills` govern extension- and skill-provided capability;
`tools:` governs pi's builtins. Between them, **an automaton that cannot modify
the filesystem IS now expressible** — `tools: [read, grep]` leaves a run with no
`write`, `edit` or `bash` at all, and `automatons/run_integration_test.ts`
drives that through a real session.

That is a genuine reduction in reach, and it is not the same as confinement:

- It binds the **model's** tool calls, not the process. Anything an enabled
  extension does inside its own `execute()` is untouched, and an extension can
  do whatever Deno can. A run with `tools: []` and one extension that shells out
  is not restricted in any meaningful sense.
- Omitting the key is the default, and the default is everything. An automaton
  written before this existed, or saved by any caller that does not know the
  key, has every builtin.

So the honest reading of a restricted automaton is "the model was handed a
smaller set of levers", not "this run is contained". See
[extensions.md](extensions.md) Deferred #1 for the interception that would make
the gate itself real.

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

Every record carries a `trigger`: `manual` for the button, `cron` for a
schedule, `kanban` for a card arriving. A `kanban` record also carries the
`card` that fired it — `trigger` says what kind of thing launched the run, and
by the time anyone reads it the board has moved on. Between them they are what
keeps "why did this fire?" answerable.

Stop is available while a run is `running`. There is no turn or wall-clock cap:
any number would be arbitrary, and an automaton killed mid-edit is worse than
one running long in a list you are watching. A scheduled run is the case that
tests this — nobody is watching the list — but the schedule's own re-entrancy
rule bounds the damage to one run at a time per automaton, which is what a cap
was wanted for.

### Runs do not survive quitting pique

A run lives in the app's memory, so closing pique ends it. Any record left
`running` is repaired to `failed` with "interrupted by shutdown" at the next
start, rather than leaving a row that would never change. This is also why a
schedule only fires while pique is open: there is no daemon behind it.

## Scope

Automatons inherit like everything else: root's are launchable from every
workspace, a workspace can add its own, and a same-named local one shadows
root's. See [scopes.md](scopes.md).

Two things always belong to the **launching** scope, even when the definition
was inherited from root: the run and its record, and everything the run resolves
against — base prompt, kanban board, working directory, and the model unless the
file pins one. A definition's triggers are the part that does not inherit at
all: a `cron:` fires in the scope holding the file and nowhere else, and a
`kanban:` fires only for that scope's own board.

Extensions a file names are chain-resolved, packages included — an automaton in
root that names a root package launches from a workspace too. What the check
enforces is that a human enabled the package somewhere on the chain, not which
scope; naming one that nobody enabled still refuses the launch rather than
letting pi fetch it.

## Deferred

### 1. `define_automaton`

There is no agent-facing tool for authoring one, and `automatons/pending/`
exists unused, ready for it. An automaton grants no capability its scope has not
already approved, but it does create an unattended runner, which is worth a
human reading first.

### 2. Restricting pi's builtins — built as `tools:`

Shipped; see the file format above. What is still unbuilt is the same control
for **chat**, which has no `tools:` of its own — a chat agent gets every
builtin, and there is no surface asking for anything else. Restricting builtins
matters most where nobody is watching, which is why the automaton got it first.

### 3. Per-automaton thinking level and base prompt

`model:` landed; these two did not. A run's thinking level still comes from the
scope's chat defaults and its system prompt from the scope's `agent/SYSTEM.md`.
Both are the same shape of addition as `model:` — a frontmatter key read in
`launchAutomaton` — and neither has come up in practice yet.

### 4. Run retention

Nothing prunes `runs/` or `sessions/`. That was tolerable while every run came
from a button press. It no longer is: `*/15 * * * *` writes ~35,000 records a
year, plus a session JSONL each, and the module's list reads every one of them
to show the five most recent. This is now the first thing cron owes.

### 5. Concurrency

`wip:` bounds one automaton's card-triggered runs in one scope, and nothing
bounds the total. Cron has no `wip:` of its own and its re-entrancy rule is per
automaton, so ten automatons sharing one `0 9 * * *` still start ten runs at
nine o'clock; ten each holding themselves to three cards are thirty runs against
one model runtime.

### 6. A queued fire does not survive a restart

The kanban queue is in memory. A card waiting for a `wip:` slot when pique
closes is simply not waiting at the next start, and nothing says so — it sits in
the column looking exactly like one nobody has picked up yet. Runs die the same
way, but a run at least leaves a record, repaired to `failed`; a queued fire
leaves nothing behind at all.
