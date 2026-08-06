# pique

A harness to get you curious.

## Decisions

1. A view is one thread for one context: its own chat window, and the modules
   sitting beside it. A workspace groups several of those — they share its
   directory, tools, prefs and board, but not a conversation. (Chat windows used
   to be sticky between views; one conversation per view is what lets a single
   workspace carry parallel lines of work.)
2. System prompts can do more harm than good. Not specifying one within pique
   removes it entirely.

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

- System Prompt: A markdown file which gets injected into every context window
  before the conversation starts. There is a default system prompt at
  ~/.pique/SYSTEM.md. Absence of this file removes the system prompt entirely.
  There is also a system prompt available per workspace in
  ~/.pique/workspace/SYSTEM.md
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

### Modules

- Kanban Board: Standard kanban-style board accessible for both agents and
  humans.
- Explorer: File explorer which opens into an $EDITOR terminal window.
- Terminal: Terminal which opens with current $SHELL.
- Diff: Git diff of highlighted item (or current workspace folder).
- Library: Extensions, prompt templates and skills for the current scope —
  review, enable, edit.
- Automatons: Named agents — one prompt template plus the extensions and skills
  they may load — launched by a button and, later, by a card move or a schedule.
