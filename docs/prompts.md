# Prompt templates

A **prompt template** is a reusable message, stored as one markdown file, that
you send by typing `/name` in a Chat module. It is pi's own feature — pique adds a
place to write them.

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
keys are ignored.

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

## Where they live

```
~/.pi/agent/prompts/
  review-staged.md     invocable as /review-staged
```

That is pi's own agent dir, shared with the `pi` CLI, and `prompts/` in it is
exactly where pi looks — so a template saved here is in both. Settings → Library
is a full editor: create, edit, delete. An agent writes one with pi's own `write`
tool, and it is invocable as soon as it lands.

## Editing takes effect immediately

Prompt templates are read from the resource loader on every prompt, so saving one
refreshes the running conversations (`chatReloadPrompts` →
`resourceLoader.reload()`) and the `/` menu, **without** restarting the agent or
losing the transcript. The system prompt is the one that needs asking for: it is
rebuilt only when pi's own `reload()` runs, which is what `/reload` does — see
[extensions.md](extensions.md) Deferred #1.

## Steering vs. sending

A template's body arrives as **your message**, not as system-prompt text. That
is the whole difference between the two places an instruction can live, and it
decides which one to use:

|                                          | Where                                         | Reaches the model as               |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------- |
| A standing instruction, every conversation | `~/.pi/agent/SYSTEM.md` or `APPEND_SYSTEM.md` | the system prompt                  |
| An instruction for one task, on demand   | `~/.pi/agent/prompts/<name>.md`               | a user turn, when you type `/name` |

Nothing is selectable per conversation: every conversation runs the same system
prompt (or, in a trusted project, that project's own `.pi/SYSTEM.md`). Editing that file does reach a running
conversation, but only when it asks — `/reload` — whereas a template takes
effect the moment it is saved, because it never touches the system prompt at all
(above).

pique used to have a third thing, a **profile**, whose body was appended to the
system prompt and which carried a tool allowlist. It is gone; templates and
`SYSTEM.md` are what remain. Old profiles may still be on disk under
`~/.pique/scopes/` and are no longer read by anything. Porting
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
whenever two templates share a name. Surfacing it would catch collisions with
package- and project-supplied templates, which pique cannot see from disk
alone.

### 2. Argument validation

`argument-hint` is documentation, not a schema. Invoking `/review-staged` with
no arguments substitutes empty strings and sends the result anyway.

### 3. Editing project- and package-supplied templates

The Library lists and edits the templates in pi's agent dir only. The ones pi
finds in `.pi/prompts/` or inside a package are invocable but not editable here
— the file belongs to the repo or the package.
