# Pique Agent Profiles — Design

**Date:** 2026-07-28 **Status:** Proposed (pre-implementation)

## Purpose

Let a human or an agent define a **profile**: a named base prompt plus an
allowlist of tools, stored as one markdown file with frontmatter. A Chat module
runs under a chosen profile, so "reviewer that cannot write", "planner with no
shell", and "the usual coding agent" are three files rather than three ad-hoc
conversations.

## Scope

**In:**

- One markdown file per profile; the filename (minus `.md`) is the profile's
  name.
- Frontmatter carries the tool allowlist and a description; the body is prompt
  text.
- Per-scope storage with root inheritance, exactly like defined tools.
- A profile picker in the Chat footer that restarts the agent and becomes the
  scope default.
- `define_profile` for agents, quarantined behind the same review gate as
  `define_tool`.
- A Settings → Profiles tab to review, approve, reject and revoke.

**Out (deferred):** an in-app profile editor, per-profile model/thinking pins,
applying a profile to a running conversation without a restart, profiles for
anything other than the Chat module.

## What pi already does (verified, 2026-07-28)

Both halves of a profile are existing `createAgentSession` options. A spike
drove the real SDK under Deno and asserted on the resulting session:

| Need               | Mechanism                                            | Result                                                        |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| Tool allowlist     | `createAgentSession({ tools })` → `allowedToolNames` | filters builtins, extension tools and SDK `customTools` alike |
| Prompt replacement | `DefaultResourceLoader({ systemPrompt })`            | replaces pi's preamble; keeps project context, skills, cwd    |
| Prompt addition    | `DefaultResourceLoader({ appendSystemPrompt })`      | keeps pi's preamble and appends                               |
| Tool inventory     | `session.getAllTools()`                              | `{ name, sourceInfo.source }` for builtin / sdk / extension   |

Two findings drive the design:

1. **The allowlist is enforcement, not advice.** It is applied in
   `_refreshToolRegistry`, so an excluded tool is absent from the registry
   entirely — the spike confirmed a later `setActiveToolsByName` (the same entry
   point extensions get via `setActiveTools`) cannot re-enable it. This is the
   first hard capability boundary in pique;
   [defined-tools.md](../../defined-tools.md) is explicit that the approval gate
   is not one.
2. **The prompt is fixed at session creation.** `AgentSession` exposes
   `get systemPrompt` with no setter, and pique keeps one long-lived agent per
   workspace ([chat/store.ts:34](../../../src/lib/chat/store.ts:34)). Switching
   profile therefore means starting a new agent and losing the transcript.

## Decisions

1. **Two prompt layers, not one.** The **base** prompt is pi's default unless
   the scope supplies one, and the **profile body** is appended to whatever that
   base is. A profile refines an agent; it does not have to restate one.
   - Base: `scopes/<id>/agent/SYSTEM.md` — pi's own filename and location, so a
     user who knows pi needs no new concept. pique resolves it along
     `chain(scope)` (nearest wins) and passes it as `systemPrompt`, which is
     what makes root's base reach a workspace; pi's own discovery only ever
     looks in the one `agentDir`.
   - Profile body → `appendSystemPrompt: [body]`.
   - Neither present → pi's default preamble, i.e. today's behaviour exactly.
2. **Per-scope, root inherited.** `scopes/<id>/profiles/*.md`, resolved through
   `chain(scope)`; a workspace sees root's profiles plus its own, and a
   same-named local profile shadows root's. Consistent with tools, chat defaults
   and boards.
3. **Profiles live outside `agent/`.** pi auto-discovers `<agentDir>/SYSTEM.md`,
   `extensions/*.ts` and skills. A directory of markdown inside `agent/` invites
   pi to interpret it; `scopes/<id>/profiles/` cannot collide by construction.
4. **The filename is the name.** No `name:` frontmatter key, so the two can
   never disagree. Basenames must match `/^[a-z0-9][a-z0-9-]*$/` (the
   `scope/paths.ts` shape); a file that does not match is skipped rather than
   raising, because the directory is user-editable.
5. **`tools:` omitted ≠ `tools: []`.** Omitted means no allowlist — pi's default
   set plus every extension and custom tool, i.e. an unrestricted agent.
   `tools: []` means an agent with no tools at all. Both are legitimate; the
   difference must be documented.
6. **A profile narrows, never widens.** The allowlist filters the tools that
   scope already loaded. It cannot grant an unapproved tool, and a name that
   exists in no scope is silently ignored by pi — which is what lets a root
   profile naming a workspace's tool degrade gracefully instead of failing.
7. **Allowing `bash` allows everything.** A read-only profile must exclude
   `bash`, `write` and `edit` together. Say so in the docs rather than trying to
   detect it.
8. **Agent-authored profiles are quarantined.** `define_profile` can only write
   into `profiles/pending/`; approving is a rename into `profiles/`. The
   allowlist half is harmless (decision 6), but the body becomes system-prompt
   text for a later agent, and that is exactly what a human should read first.
9. **The agent's rationale goes in frontmatter, not the body.** The body is
   prompt text that will reach a model; a `rationale:` key is shown to the
   reviewer and never sent.
10. **Switching profile restarts the conversation,** with a confirm. Per finding
    2 there is no honest alternative, and pretending otherwise would leave the
    prompt stale.

## Architecture

### On disk

```
~/.pique/scopes/<root|ws-N>/
  agent/SYSTEM.md        optional base prompt for this scope (pi's own convention)
  profiles/
    reviewer.md          live — selectable
    pending/
      auditor.md         quarantined — agent-written, never selectable
```

Listing globs `profiles/*.md` without recursion, so a pending file can never be
selected — the same "location is the approval record" property the tools dirs
have.

### File format

```markdown
---
description: Reads and explains code, never modifies it.
tools: [read, grep, find, ls, kanban_get_board]
---

You are reviewing a codebase you do not own. Prefer quoting the source over
paraphrasing it, and never propose a change you have not read the surrounding
code for.
```

`description` and `tools` are both optional; unknown keys are ignored (lenient,
as pi is with skills). Parsed with `jsr:@std/front-matter@^1/yaml` — a new
dependency, verified fetchable and correct against this exact shape.

### Modules

| File                                    | Change | Responsibility                                                                                                                                                                |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/profiles/paths.ts`             | New    | `profilesDir`, `pendingDir`, `profilePath`, `basePromptPath`, `assertProfileName` — every path keyed by scope                                                                 |
| `src/lib/profiles/parse.ts`             | New    | Pure `parseProfile(name, text) → { name, description, tools?, body }`; unit-tested with no filesystem                                                                         |
| `src/lib/profiles/service.ts`           | New    | `listProfiles` / `listVisibleProfiles` / `readProfile` / `approve` / `reject` / `revoke`, plus `resolveProfile(scope, name)` and `resolveBasePrompt(scope)` walking `chain()` |
| `src/lib/profiles/agent-tools.ts`       | New    | `define_profile`, scope-bound, writes into `pending/` only                                                                                                                    |
| `src/lib/profiles/bindings.ts`          | New    | Frontend half of the `profile*` binding contract                                                                                                                              |
| `src/lib/chat/agent.ts`                 | Modify | `startAgent` takes `profile`; passes `tools`, `systemPrompt`, `appendSystemPrompt`                                                                                            |
| `src/lib/chat/bindings.ts`              | Modify | `chatStart` gains `profile`; `chatListProfiles`                                                                                                                               |
| `src/lib/chat/store.ts`                 | Modify | `profile` store + `pickProfile()` that stops, restarts and clears, then persists to scope config                                                                              |
| `src/lib/chat/Chat.svelte`              | Modify | Profile `<select>` beside the model and thinking pickers                                                                                                                      |
| `src/desktop.ts`                        | Modify | `profile*` `win.bind` handlers                                                                                                                                                |
| `src/lib/settings/SettingsModal.svelte` | Modify | Profiles tab: own profiles approvable/revocable, inherited ones read-only                                                                                                     |
| `docs/profiles.md`                      | New    | The feature doc, in the shape of `defined-tools.md`                                                                                                                           |
| `docs/scopes.md`                        | Modify | One row in the inheritance table, one section                                                                                                                                 |
| `deno.json`                             | Modify | `@std/front-matter`                                                                                                                                                           |

### Selection and persistence

`chat.defaultProfile` joins `defaultProvider` / `defaultModel` /
`defaultThinkingLevel` in a scope's `config.json`, so it inherits per key like
the rest and a workspace can pin a profile while inheriting root's model.
`pickProfile` writes it back the way `pickModel` already does
([chat/store.ts:126](../../../src/lib/chat/store.ts:126)). A configured profile
that no longer resolves falls back to none, mirroring the existing model
fallback.

## Verification

- `parse_test.ts` — frontmatter present/absent/malformed, `tools` omitted vs
  `[]`, bad name.
- `service_test.ts` — inheritance and shadowing across `chain()`,
  approve/reject/revoke, pending never listed as live.
- `agent-tools_test.ts` — `define_profile` writes only into `pending/`, rejects
  bad names.
- `profile_integration_test.ts` (in `src/lib/chat/`) — the claim the feature
  exists to make, through the real `startAgent`, in the shape of
  `scope_integration_test.ts`: a profile's allowlist is reflected in
  `activeToolNames`, an excluded builtin is absent, the body appears in
  `session.systemPrompt`, and a scope `SYSTEM.md` replaces pi's preamble while
  the body still appends.

## Deferred

1. **In-app editing.** Authoring means writing the file, exactly as with defined
   tools ([defined-tools.md](../../defined-tools.md) deferred #6). An editor
   would want a tool picker, and `session.getAllTools()` is the mechanism for it
   — it returns names with `builtin` / `sdk` / `extension` provenance, but only
   from a live session.
2. **Flagging tool names that resolve to nothing.** A typo in `tools:`
   disappears silently. Surfacing it needs the same live-session inventory as
   #1.
3. **Applying a profile without a restart.** Only if pi grows a system-prompt
   setter; the allowlist half could already be changed live, but half a profile
   is worse than none.
4. **Per-profile model and thinking level.** A natural frontmatter extension,
   deliberately omitted until the prompt/tools pair is proven.
5. **Rejected-profile memory.** Reject deletes; nothing records that a human
   said no — the same gap as `defined-tools.md` deferred #7.
