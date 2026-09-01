# pique

A harness to get you curious.

## Installing

Build it from source. There are no published binaries: shipping a macOS app
that opens on someone else's Mac means signing and notarizing it, which needs a
paid Apple Developer account, and an unsigned download arrives quarantined and
is refused. An app you build yourself was never downloaded and is never
quarantined, so this is also the shorter path.

All you need is [Deno](https://deno.com) 2.9.5 or newer.

```
git clone https://github.com/ivypuckett/pique
cd pique
deno task dev
```

`deno task dev` is the whole pipeline — it builds the frontend, packages the
desktop app (into `pique/` on Linux and Windows, as `pique.app` on macOS), and
launches it. Run it again after pulling to
rebuild and relaunch.

To keep the app around rather than starting it from the checkout: on macOS drag
`pique.app` to Applications; on Linux and Windows `pique/pique` and
`pique\pique.exe` are the packaged app and can be moved anywhere. Launching one
of those directly runs the same binary `deno task dev` does, minus the rebuild
— but on Linux it also skips the environment `deno task dev` fixes up for
WebKitGTK, so if the window never appears, start it from the task instead.

## Decisions

1. A view is one thread for one context: its own chat window, and the modules
   sitting beside it. A workspace groups several of those — they share its
   directory, tools, prefs and board, but not a conversation. (Chat windows used
   to be sticky between views; one conversation per view is what lets a single
   workspace carry parallel lines of work.)
2. System prompts can do more harm than good. Not specifying one within pique
   removes it entirely.
3. Linux, macOS and Windows are all supported targets. Linux is what pique is
   developed against today, and the codebase still carries POSIX assumptions the
   other two trip over — an unset `$HOME`, `/` hardcoded as the path separator.
   Those are bugs to fix, not the design.

## Information Architecture

### Interactable Surface

- Workspace: A set of views which empower a user to interact with the harness.
- View: A chat window and one or more modules in a tab array which allow the
  user to take specific actions.
- Workspace Directory: The root directory where the agent and modules talk to
  each other.
- Module: A single pane which presents information and allows for specific
  actions to be taken against it.

Notes:

- Workspaces tile vertically and views horizontally.
- The default workspace exists to allow an agent to manage the harness. In
  practice, it centralizes/defaults most settings.
- Each view holds its own chat; what views inside a workspace share is
  everything else — its directory, tools, prefs and board.

### Agent Structure

- Model: Sonnet, Opus, Fable, etc.
- Provider: LM Studio, Anthropic, etc.
- Thinking Level: Sets how much the agent deliberates before speaking.

- System Prompt: A markdown file, `agent/SYSTEM.md` in a scope's directory,
  which replaces pi's own preamble for every agent that runs there. The nearest
  one on the chain wins, so a workspace's shadows the root one it inherits.
  pique ships none (decision 2) — with no `SYSTEM.md` anywhere, pi's preamble is
  what runs.
- System Prompt Appendix: `agent/APPEND_SYSTEM.md`, added on top of whatever the
  base turned out to be rather than replacing it. Merges the other way: every
  one on the chain applies, root's first — so root holds house rules and each
  workspace adds its own archetype. Both are edited in the Library; see
  [docs/scopes.md](docs/scopes.md).
- Prompt Template: A markdown file you send as a message by typing `/name` in a
  chat, with `$1`/`$@` arguments substituted in. Plain
  [pi Prompt Templates](https://pi.dev/docs/latest/prompt-templates), per
  workspace and inherited from the default one — see
  [docs/prompts.md](docs/prompts.md).
- Extension: https://pi.dev/docs/latest/extensions
- Skill: https://pi.dev/docs/latest/skills
- Automaton: A prompt template plus the exact extension and skill set a run may
  load, launched without a conversation — see
  [docs/automatons.md](docs/automatons.md).
- Subagent: A named system prompt, plus an optional tool and model restriction,
  that a chat agent delegates a task to. It runs in its own isolated session and
  reports back as text — see [docs/subagents.md](docs/subagents.md).

### Modules

- Kanban Board: Standard kanban-style board accessible for both agents and
  humans.
- Editor: File tree which opens files into an $EDITOR terminal window.
- Terminal: Terminal which opens with current $SHELL.
- Diff: Git diff of highlighted item (or current workspace folder).
- Library: The current scope's system prompt and appendix, extensions, prompt
  templates, skills and subagents — review, enable, edit.
- Automatons: Named agents — one prompt template plus the extensions and skills
  they may load — launched by a button, or unattended by a schedule or a card
  arriving in a column, which first need a human to approve the definition.
