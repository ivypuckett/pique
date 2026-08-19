# Subagents

A **subagent** is a named system prompt, stored as one markdown file, that a
chat agent can hand a task to. The task runs in its own nested session with its
own tools and model, and comes back as text. The conversation you are having is
not part of it and does not grow by it.

The point is delegation with a narrower surface: a fast read-only scout on a
cheap model, a planner that cannot write, a reviewer that sees only what you
tell it. Where a prompt template is text _you_ send ([prompts.md](prompts.md)),
a subagent is a worker the _agent_ sends work to.

## The file

```markdown
---
description: Fast, read-only codebase recon
tools: read, grep, find, ls
model: claude-haiku-4-5
---

You are a scout. Investigate and report findings concisely. You cannot edit
files, so do not propose diffs — describe what you found and where.
```

The **filename is the name** — `scout.md` is `run_subagent(agent: "scout")`.
Names are lowercase letters, digits and dashes, the same rule prompt templates
are held to. The body is the child's system prompt, used verbatim.

`description` is what the calling agent reads when choosing; write it for that
reader. Both other keys are optional:

- **`tools`** — comma-separated, restricting the child to those names (`read`,
  `grep`, `find`, `ls`, `bash`, `edit`, `write`). Omit and it gets pi's default
  base set. This is the one thing a subagent can do that nothing else in pique
  can — see [Scope](#scope).
- **`model`** — a bare id (`claude-haiku-4-5`) matched across every available
  model, or `provider/id` when you need to be exact. Omit and the child inherits
  the model the parent conversation is running. A named model that is not
  available falls back to the parent's rather than failing the call.

Malformed frontmatter does not hide the file: it is still listed, with the body
intact and an `error` recorded (`agents/parse.ts`), so a broken definition shows
up as broken instead of silently missing.

## The two tools

Both are compiled into pique and bound to the scope the chat agent runs in
(`agents/agent-tools.ts`, wired in `chat/agent.ts`).

**`define_subagent`** — writes the file. Takes `name`, `description`,
`system_prompt`, and optionally `tools` and `model`. Re-defining a name
overwrites it. There is no review step and no Library UI; ask the agent for one
in prose and it exists:

> define a subagent called reviewer that reads code and flags bugs, give it read
> grep and ls, and use a cheap model

**`run_subagent`** — takes `agent` and `task`. The task must stand alone: the
child sees nothing of the parent conversation except the string you pass it.

Definitions are re-read from disk on **every** `run_subagent` call, not cached
at session start, so one defined mid-conversation is usable on the very next
tool call — no `/reload`, no new Chat module. Only the tool _description_'s list
of available agents is a session-start snapshot, which is why it says so.

## One directory, no quarantine

```
~/.pique/scopes/<scope>/agent/agents/
  scout.md
  reviewer.md
```

Unlike prompt templates and extensions there is no `pending/` dir, and that is a
decision rather than unfinished work. A subagent is strictly _less_ capable than
the agent that defines it — a subset of that agent's tools, chosen by it — and
the definer already holds `write` and `bash`, so there is nothing to escalate
through. [security.md](security.md) records the reasoning and, more importantly,
what it accepts: a definition written into root persists and is re-applied
later, so an instruction that arrived by prompt injection outlives the
conversation that introduced it. Read that section before deciding this is fine
for your threat model.

The dir sits inside the scope's `agent/` dir next to `prompts/` and
`extensions/`, though unlike those two pi never discovers it — pique reads it
itself.

## Scope

Definitions are per-scope and inherited: a workspace sees root's plus its own,
and a workspace definition **shadows** a root one of the same name
([scopes.md](scopes.md)). Defining one in root makes it available everywhere.

`define_subagent` writes into the scope its calling agent runs in, so the tool's
own description tells the agent how far its definition will reach — root's
"available in every workspace" versus a workspace's "only there".

## What the child gets, and does not

`runSubagent` (`agents/service.ts`) builds the nested session against a **fresh
temp `agentDir`**, discarded when the call returns. That is what makes the
isolation real rather than nominal:

|                                        |                                    |
| -------------------------------------- | ---------------------------------- |
| System prompt                          | the definition's body, verbatim    |
| Tools                                  | `tools:`, or pi's default base set |
| pique's own tools (kanban, `define_*`) | **none**                           |
| `run_subagent` itself                  | **none** — no recursion            |
| Extensions, skills, prompt templates   | **none**                           |
| Transcript                             | in-memory, never written to disk   |

Aborting the parent propagates: the tool call's signal is wired to the child's
`session.abort()` for the duration of the call. Because the child is in-process
rather than a spawned `pi` CLI, there is no subprocess to orphan.

The result is every assistant text block the run produced, joined. A child that
ends in an error state raises, so the parent sees a failed tool call rather than
an empty answer.

## Known limits

- **No progress.** The parent sees one tool call that returns everything at the
  end; the child's own tool calls are not streamed into the transcript. A long
  delegation looks like a hang.
- **No timeout or turn cap.** A child that will not converge runs until it is
  aborted.
- **No UI.** Definitions are created by `define_subagent` or by hand; there is
  no Library tab listing or editing them yet.
- **Not a replacement for profiles.** pique's old profiles carried a `tools:`
  allowlist for _your_ conversation ([prompts.md](prompts.md)); a subagent
  applies one to a delegated session instead. It is the nearest thing that
  exists, not the same feature.
