# pique

A harness to get you curious.

## Decisions

1. A single workspace is meant to have a single chat window between a user and agent. That agent may have subagents, but the goal is that the user is given one thread for one context. Because of this, chat windows are sticky between views.
2. System prompts can do more harm than good. Not specifying one within pique removes it entirely.

## Information Architecture

### Interactable Surface

- Workspace: A set of views which empower a user to interact with the harness.
- View: A chat window and one or more modules in a tab array which allow the user to take specific actions.
- Workspace Directory: The root directory where the agent and modules talk to each other.
- Module: A single pane which presents information and allows for specific actions to be taken against it.

Notes:
- Workspaces tile vertically and views horizontally.
- The default workspace exists to allow an agent to manage the harness. In practice, it centralizes/defaults most settings.
- Chats are sticky between views inside the same workspace.

### Agent Structure

- Model: Sonnet, Opus, Fable, etc.
- Provider: LM Studio, Anthropic, etc.
- Thinking Level: Sets how much the agent deliberates before speaking.

- System Prompt: A markdown file which gets injected into every context window before the conversation starts. There is a default system prompt at ~/.pique/SYSTEM.md. Absence of this file removes the system prompt entirely. There is also a system prompt available per workspace in ~/.pique/workspace/SYSTEM.md
- Profile: A markdown file with frontmatter which allowlists tools, extensions, and skills and adds onto the system prompt. Essentially [pi Prompt Templates](https://pi.dev/docs/latest/prompt-templates), but with allowlists and settings attached.
- Extension: https://pi.dev/docs/latest/extensions
- Skill: https://pi.dev/docs/latest/skills

### Modules

- Kanban Board: Standard kanban-style board accessible for both agents and humans.
- Explorer: File explorer which opens into an $EDITOR terminal window.
- Terminal: Terminal which opens with current $SHELL.
- Diff: Git diff of highlighted item (or current workspace folder).

