# Prompt templates

A **prompt template** is a reusable message, stored as one markdown file, that
you send by typing `/name` in a Chat module. It is pi's own feature — pique adds
inheritance across scopes, a place to write them, and a review gate for the ones
an agent writes.

It grants nothing and does not run until you type its name. It is text that
lands in the input box.

## The file

```markdown
---
description: Review the staged changes
argument-hint: "<focus>"
---

Review `git diff --cached`, focusing on $@. Flag bugs and security issues; skip
style.
```

The **filename is the name** — `review-staged.md` is `/review-staged`. Names are
lowercase letters, digits and dashes; a file that does not match is skipped
rather than breaking the listing. Both keys are optional: `description` falls
back to the body's first line (truncated at 60 chars, pi's rule, reproduced in
`prompts/parse.ts`), and `argument-hint` only decorates the `/` menu. Unknown
keys are ignored, which is what lets an agent's `rationale` ride along in the
frontmatter without reaching the model.

## Arguments

Everything after the name is split bash-style, respecting quotes, and
substituted into the body by pi:

|                      |                                          |
| -------------------- | ---------------------------------------- |
| `$1`, `$2`           | positional                               |
| `$@`, `$ARGUMENTS`   | all of them, joined                      |
| `${1:-default}`      | positional, with a fallback when missing |
| `${@:2}`, `${@:2:3}` | from the 2nd on; 3 starting at the 2nd   |

`/review-staged "null checks" auth.ts` expands `$@` to `null checks auth.ts` and
`$1` to `null checks`. Substitution is not recursive: an argument that itself
contains `$1` is left alone.

## The two directories

```
~/.pique/scopes/<scope>/agent/prompts/
  review-staged.md     live — invocable as /review-staged
  pending/
    audit.md           quarantined — agent-written, never invocable
```

These live **inside** the scope's `agent/` dir, because `<agentDir>/prompts/` is
exactly where pi looks. `pending/` nests safely under the live dir because pi's
directory scan does not recurse; that claim is pinned by a test against the real
loader (`prompts/integration_test.ts`), since nothing would announce it if a
future pi release changed.

`define_prompt` (`prompts/agent-tools.ts`) can only ever write into `pending/`.
Approving is a **rename** into `prompts/` — the file's location is the approval
record, so no flag can drift from what is actually invocable.

```
agent calls define_prompt  →  <scope>/agent/prompts/pending/<name>.md   (inert)
user reads the text in the Library module
  Approve  →  mv into prompts/  →  invocable as /<name>
  Reject   →  deleted
```

**A human editing a template writes straight to live.** There is no approval
step for your own work, because there is nobody to approve it to: the gate
exists so that an agent cannot put an entry in your `/` menu that you have not
read. The Library module is a full editor — create, edit, delete — not just a
review queue.

## Scope

Templates are per-scope and inherited like local extensions: a workspace sees
root's plus its own. See [scopes.md](scopes.md). Saving one in root makes it
invocable everywhere.

pi discovers only the one `agentDir` it is given, so inheritance is assembled in
`chat/agent.ts`: ancestors' `prompts/` dirs are passed as
`additionalPromptTemplatePaths`. Note the asymmetry with extensions — that
option takes **directories**, while `additionalExtensionPaths` insists on files
(see [extensions.md](extensions.md)).

A local template **shadows** a root one of the same name. pi's loader collapses
the collision itself, first path wins, and the order pique sets up — own dir
first, ancestors after — is what makes the workspace's copy the survivor.

## Editing takes effect immediately

Prompt templates are read from the resource loader on every prompt, not baked in
at session creation the way the system prompt is. So saving or approving one
refreshes the running conversations (`chatReloadPrompts` →
`resourceLoader.reload()`) and the `/` menu, **without** restarting the agent or
losing the transcript.

## Steering vs. sending

A template's body arrives as **your message**, not as system-prompt text. That
is the whole difference between the two places an instruction can live, and it
decides which one to use:

|                                                          | Where                     | Reaches the model as                       |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------ |
| A standing instruction, every conversation in this scope | `<scope>/agent/SYSTEM.md` | the system prompt, replacing pi's preamble |
| An instruction for one task, on demand                   | `agent/prompts/<name>.md` | a user turn, when you type `/name`         |

Nothing is selectable per conversation: pi fixes the system prompt at session
creation and exposes no setter, so anything that varied per conversation would
have to restart the agent and discard the transcript. Templates avoid that
entirely by not touching the system prompt — which is why editing one takes
effect immediately (above).

pique used to have a third thing, a **profile**, whose body was appended to the
system prompt and which carried a tool allowlist. It is gone; templates and
`SYSTEM.md` are what remain. Old profiles are still on disk in
`~/.pique/scopes/<scope>/profiles/` and are no longer read by anything. Porting
one is a rewrite rather than a move: a body written to be appended to a system
prompt usually reads oddly as a message, and there is no replacement at all for
its `tools:` allowlist.

## Other sources

pi also loads templates pique does not manage, and they show up in the same `/`
menu:

- **Project**: `.pi/prompts/*.md` under the module's working directory, when the
  project is trusted. A repo can ship its own commands.
- **Packages**: an installed pi package's `prompts/` dir or `pi.prompts`
  manifest entry.

---

## Deferred

### 1. Collision diagnostics

pi's loader records a `collision` diagnostic naming the winning and losing file
whenever two templates share a name. The Library module badges a shadowed root
template from its own listing instead; surfacing pi's diagnostics would also
catch collisions with package- and project-supplied templates, which pique
cannot see from disk alone.

### 2. Argument validation

`argument-hint` is documentation, not a schema. Invoking `/review-staged` with
no arguments substitutes empty strings and sends the result anyway.

### 3. Rejected-template memory

Reject deletes the file. An agent can immediately re-define the same template,
and nothing records that a human already said no — the same gap
[extensions.md](extensions.md) records.

### 4. Editing project- and package-supplied templates

The Library module lists and edits a scope's own templates only. The ones pi
finds in `.pi/prompts/` or inside a package are invocable but not editable here
— the file belongs to the repo or the package, not to the scope.
