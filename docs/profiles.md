# Profiles

A **profile** is a named base prompt plus an allowlist of tools, stored as one markdown
file. A Chat module runs under a profile, so "reviewer that cannot write" and "the usual
coding agent" are two files rather than two habits.

## The file

```markdown
---
description: Reads and explains code, never modifies it.
tools: [read, grep, find, ls]
---

You are reviewing a codebase you do not own. Prefer quoting the source over
paraphrasing it, and never propose a change you have not read the surrounding code for.
```

The **filename is the name** — `reviewer.md` is the profile `reviewer`, and there is no
`name:` key that could disagree with it. Names are lowercase letters, digits and dashes;
a file that does not match is skipped rather than breaking the listing. `description` and
`tools` are both optional, and unknown keys are ignored.

## The two prompt layers

The body is **appended** to a base prompt. The base is pi's own preamble unless the scope
supplies `agent/SYSTEM.md`, in which case that replaces it — pi's own filename and
convention, so nothing new to learn:

| | Where | Effect |
|---|---|---|
| Base | `~/.pique/scopes/<scope>/agent/SYSTEM.md` (optional) | Replaces pi's preamble |
| Profile | the body of `profiles/<name>.md` | Appended to whichever base won |

pi discovers `SYSTEM.md` from the one `agentDir` it is given, so **pique** resolves it
along the scope chain instead (`profiles/service.ts:resolveBasePrompt`) — that is what
lets root's base prompt reach a workspace. Project context (`AGENTS.md` / `CLAUDE.md`),
skills and the cwd line are appended by pi either way.

## The allowlist

`tools:` is passed to pi as `allowedToolNames`, which filters the registry itself — pi's
builtins, tools from enabled extensions and pique's own compiled-in tools all
alike. Three things follow, and all three matter:

- **Omitted is not empty.** No `tools:` key means *no restriction* — the default tool set
  plus every extension and custom tool. `tools: []` means an agent with **no tools at all**.
- **A profile narrows, never widens.** The allowlist filters what the scope already
  loaded; naming a tool that does not exist there is a silent no-op, not a grant. That is
  deliberate: it lets a root profile name a tool only some workspaces have.
- **Allowing `bash` allows everything.** A genuinely read-only profile must exclude
  `bash`, `write` **and** `edit` together. Nothing detects this for you.

Unlike the extension review gate — which [extensions.md](extensions.md) is
explicit is *not* containment — this filter is enforced inside pi's tool registry, and an
extension calling `setActiveTools` cannot re-enable what a profile excluded.

## The two directories

```
~/.pique/scopes/<scope>/profiles/
  reviewer.md          live — selectable in a Chat module
  pending/
    auditor.md         quarantined — agent-written, never selectable
```

`define_profile` (`profiles/agent-tools.ts`) can only ever write into `pending/`.
Approving is a **rename** into `profiles/` (`profiles/service.ts:approveProfile`) — the
file's location is the approval record, so there is no flag that can drift from what is
actually selectable. Listing never recurses, which is what keeps `pending/` inert.

The agent's rationale is written into the profile's **frontmatter**, not its body: the
body becomes system-prompt text for whatever model runs under it, and the rationale is for
the human reading the review.

```
agent calls define_profile  →  <scope>/profiles/pending/<name>.md   (inert)
user reads the prompt in Settings → Profiles
  Approve  →  mv into profiles/  →  selectable in the Chat footer
  Reject   →  deleted
```

## Scope

Profiles are per-scope and inherited exactly like local extensions: a workspace sees root's
profiles plus its own, and a local profile **shadows** a root profile of the same name.
See [scopes.md](scopes.md). Approving in root makes a profile available everywhere.

The chosen profile is persisted as `chat.defaultProfile` in the scope's `config.json`, so
it inherits per key like the other chat defaults. A default naming a profile that no longer
exists degrades to **base** rather than failing to start.

**base** is what the picker calls the absence of a profile: the scope's base prompt with
nothing appended and no allowlist. It is stored as `""`, which is a real value — distinct
from the key being absent, which means "inherit the default".

## Switching

pi fixes the system prompt when the session is created and exposes no setter, so switching
profile **restarts the agent and clears the transcript** — the picker confirms before it
does. A profile revoked or edited on disk keeps running in sessions already started.

---

## Deferred

### 1. Editing profiles in the UI

Settings → Profiles reviews, approves, rejects and deletes. Authoring means writing the
file, the same gap `extensions.md` records for extensions. An editor would want a tool
picker, and `session.getAllTools()` is the mechanism — it returns each tool's name and
whether it came from a builtin, an extension or the SDK, but only from a live session.

### 2. Flagging tool names that resolve to nothing

A typo in `tools:` silently narrows the agent by one tool. Surfacing it needs the same
live-session inventory as #1.

### 3. Applying a profile without a restart

Only if pi grows a system-prompt setter. The allowlist half could already be swapped live
via `setActiveToolsByName`, but applying half a profile is worse than applying none.

### 4. Per-profile model and thinking level

A natural frontmatter extension — `model:`, `thinking:` — deliberately left out until the
prompt/tools pair has been lived with.

### 5. Rejected-profile memory

Reject deletes the file. An agent can immediately re-define the same profile, and nothing
records that a human already said no — the same gap as `extensions.md` deferred #7.
