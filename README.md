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
   directory, but not a conversation. (Chat windows used
   to be sticky between views; one conversation per view is what lets a single
   workspace carry parallel lines of work.)
2. System prompts can do more harm than good. Not specifying one within pique
   removes it entirely.
3. pique adopts pi's philosophy: it uses pi's own agent dir (`~/.pi/agent`, shared
   with the `pi` CLI) and lets pi discover what is in it. Nothing is gated or
   sandboxed by pique — an extension, or a module, is trusted code, and
   sandboxing is left to an extension that wants to provide it.
4. Linux, macOS and Windows are all supported targets. Linux is what pique is
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
- Each view holds its own chat; what views inside a workspace share is its
  directory. Everything else — tools, prompts, prefs — is the same everywhere.

### Agent Structure

- Model: Sonnet, Opus, Fable, etc.
- Provider: LM Studio, Anthropic, etc.
- Thinking Level: Sets how much the agent deliberates before speaking.

- System Prompt: `~/.pi/agent/SYSTEM.md`, which replaces pi's own preamble.
  pique ships none (decision 2) — with no `SYSTEM.md`, pi's preamble is what
  runs. In a trusted project, its own `.pi/SYSTEM.md` takes precedence.
- System Prompt Appendix: `~/.pi/agent/APPEND_SYSTEM.md`, added on top of
  whichever base applies rather than replacing it — house rules without a
  replacement preamble. Both are edited in Settings → Library.
- Prompt Template: A markdown file you send as a message by typing `/name` in a
  chat, with `$1`/`$@` arguments substituted in. Plain
  [pi Prompt Templates](https://pi.dev/docs/latest/prompt-templates) — see
  [docs/prompts.md](docs/prompts.md).
- Module: a panel of your own in the right pane — ask the agent for one (a
  board, a dashboard) and it writes it with `define_module`. See
  [docs/modules.md](docs/modules.md).
- Extension: https://pi.dev/docs/latest/extensions
- Skill: https://pi.dev/docs/latest/skills

### Modules

- Editor: File tree which opens files into an $EDITOR terminal window.
- Terminal: Terminal which opens with current $SHELL.
- Diff: Git diff of highlighted item (or current workspace folder).
- Your own: any module the agent (or you) has written — see
  [docs/modules.md](docs/modules.md).

Settings → Library lists what is in pi's agent dir — the system prompt and
appendix, extensions and installed packages, modules, prompt templates and
skills — to view, edit, install and delete.
