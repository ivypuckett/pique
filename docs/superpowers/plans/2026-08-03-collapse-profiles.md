# Collapse Profiles into Prompt Templates — Implementation Plan

**Status:** Implemented (2026-08-03). See [prompts.md](../../prompts.md) for the
feature doc; deviations from this plan are recorded at the end.

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the profile concept. One authored artifact remains — a **prompt
template**, invoked as `/name` — and the Chat footer loses its "base" picker.
What a profile did that a template does not, either moves (the scope's base
prompt) or goes (the tool allowlist).

**Architecture:** Profiles and templates are already the same shape — a markdown
file with frontmatter, per scope, inherited along `chain()`, quarantined in
`pending/` when an agent writes it, approved by a rename.
[prompts/service.ts](../../../src/lib/prompts/service.ts) says outright it is
shaped on `profiles/service.ts`. Only three things are profile-only: the body
reaching the **system** prompt rather than the input box, the `tools:`
allowlist, and `chat.defaultProfile`. The first is what forces a restart on
every switch (pi fixes the system prompt at session creation and exposes no
setter); the second and third exist only to serve it. Removing all three leaves
`src/lib/prompts/` doing the whole job, minus ~1,100 lines.

**Design doc:** none — the rationale is inline below, because this is a deletion
rather than a mechanism. Compare
[2026-08-03-unified-extensions-design.md](../specs/2026-08-03-unified-extensions-design.md),
the previous collapse, which needed one because it merged two live mechanisms
rather than retiring one.

**Tech Stack:** Deno, `@earendil-works/pi-coding-agent` 0.83, Svelte 5 (runes),
Tailwind + daisyUI, `deno test`.

---

## Background: what is actually being given up

The two collapse into one cleanly. Say plainly what does not:

1. **Steering text becomes a message, not preamble.** A profile body was
   `appendSystemPrompt`; a template body is the user's turn. "Never propose a
   change you have not read the surrounding code for" is weaker as a message
   than as system text, and it can fall out of context on compaction in a way
   system text cannot. This is the cost. What it buys is that steering no longer
   destroys the transcript — today `pickProfile` → `restart()` →
   `items.set([])`, unavoidably.
2. **The tool allowlist goes entirely.** It was real enforcement (pi's registry
   filter, which `setActiveTools` cannot re-widen), so this is a genuine loss
   and not just a simplification. It was also the weakest-hedged feature in the
   repo: [profiles.md](../../profiles.md) itself records that allowing `bash`
   allows everything, that a typo'd tool name is a silent no-op, and that there
   is no UI to author one. Decided out on 2026-08-03. If it returns, it returns
   as `tools:` frontmatter on a template applied through
   `session.setActiveToolsByName()` — which exists, takes effect next turn, and
   would need no restart. Recorded as Deferred #1.
3. **A per-scope default steer disappears** with `chat.defaultProfile`. The
   replacement is the workspace's own `agent/SYSTEM.md`, which is arguably where
   a permanent instruction belonged.

**What pi gives us, unchanged by this work:** unknown frontmatter keys are
ignored by pi's template loader (that is how `rationale` already rides along),
`additionalPromptTemplatePaths` takes directories, and a template is re-read
from the resource loader on every prompt — which is why `chatReloadPrompts`
refreshes a running conversation without restarting it.

## Decisions locked in before coding

Do not re-litigate these mid-task.

1. **The allowlist is dropped, not ported.** `createAgentSession` loses its
   `tools:` argument entirely — with no allowlist there is no caller, and the
   `undefined`-vs-`[]` distinction that `docs/profiles.md` spends a paragraph on
   stops existing.
2. **`agent/SYSTEM.md` survives and moves.** `basePromptPath` +
   `resolveBasePrompt` go to `src/lib/scope/prompt.ts`. It is a scope property
   now, not a profile one, and it keeps its `systemPrompt:` wiring in
   `startAgent` unchanged.
3. **No migration.** `~/.pique/scopes/*/profiles/` simply stops being read;
   nothing deletes it. A profile body written to be _appended to a system
   prompt_ usually reads oddly as a message, so porting one is a rewrite by
   hand, not a copy — the docs must say so rather than pretend a move is enough.
4. **`chat.defaultProfile` is dropped, not migrated.** A stale key left in an
   existing `config.json` is inert once `resolveChatDefaults` stops reading it.
5. **`define_profile` is deleted outright.** `define_prompt` already exists,
   already quarantines, already carries `rationale`. Nothing on disk encodes the
   old tool name.
6. **The `/` menu and the review gate are untouched.** Both already work; this
   plan must not tune them while passing through.
7. **`activeToolNames` stays.** It is profile-adjacent but
   `chat/scope_integration_test.ts:53` uses it to pin extension inheritance.
   `systemPromptOf` stays too — Task 2 keeps using it.

## File Structure

| File                                           | Change                                        | Responsibility after the change                                                                               |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/scope/prompt.ts`                      | New (from `profiles/paths.ts` + `service.ts`) | `basePromptPath`, `resolveBasePrompt` — the scope's `agent/SYSTEM.md`, chain-resolved                         |
| `src/lib/scope/prompt_test.ts`                 | New (from `profiles/service_test.ts`)         | The three base-prompt resolution cases                                                                        |
| `src/lib/chat/base_prompt_integration_test.ts` | New (from `chat/profile_integration_test.ts`) | Base prompt reaching a real session, root → workspace                                                         |
| `src/lib/profiles/*`                           | **Delete** (8 files, 627 lines)               | —                                                                                                             |
| `src/lib/chat/profile_integration_test.ts`     | **Delete** (176 lines)                        | —                                                                                                             |
| `src/lib/chat/agent.ts`                        | Modify                                        | Drop `opts.profile`, `profileAuthoringTools`, `appendSystemPrompt`, `tools:`, `resolveChatDefaults().profile` |
| `src/lib/chat/store.ts`                        | Modify                                        | Drop `profile`/`profiles` stores, `pickProfile`; `restart()` takes no argument                                |
| `src/lib/chat/Chat.svelte`                     | Modify                                        | Drop the picker and the `"profile"` branch of the confirm bar                                                 |
| `src/lib/chat/bindings.ts`                     | Modify                                        | `chatStart` loses `profile`                                                                                   |
| `src/lib/scope/bindings.ts`                    | Modify                                        | `ScopeConfig.chat` loses `defaultProfile`                                                                     |
| `src/desktop.ts`                               | Modify                                        | Drop the five `profiles*` binds and the service import; `chatStart` loses `profile`                           |
| `src/lib/settings/SettingsModal.svelte`        | Modify                                        | Drop the Profiles section (~155 lines), its tab, its `SCOPED_SECTIONS` entry and its state                    |
| `src/lib/prompts/agent-tools.ts`               | Modify                                        | One sentence in `define_prompt`'s description                                                                 |
| `docs/profiles.md`                             | **Delete**                                    | —                                                                                                             |
| `docs/prompts.md`                              | Modify                                        | Absorbs what survives; drops the "not a profile" framing                                                      |
| `docs/scopes.md`                               | Modify                                        | Inheritance table, "Profiles and the base prompt" → "The base prompt", template section                       |
| `docs/extensions.md`                           | Modify                                        | Three references to profiles as containment                                                                   |
| `README.md`                                    | Modify                                        | The Profile glossary line                                                                                     |

---

### Task 1: Move the base prompt out of `profiles/`

**Files:** Create `src/lib/scope/prompt.ts`, `src/lib/scope/prompt_test.ts`

The tree keeps compiling after this task: `profiles/` stays whole and simply
loses two exports' worth of duty.

- [x] **Step 1: Write the failing tests**

Port the three `resolveBasePrompt` cases out of
`src/lib/profiles/service_test.ts` (reuse that file's `withTempHome`): `ws-1`'s
own `SYSTEM.md` wins when present; root's is returned when the workspace has
none; `undefined` when neither exists.

The third case is the one that matters and must say why in a comment —
`undefined` has to reach pi **as** `undefined`, because that is what leaves pi's
own preamble in place.

- [x] **Step 2: Implement**

`src/lib/scope/prompt.ts` — move `basePromptPath` from `profiles/paths.ts` and
`resolveBasePrompt` from `profiles/service.ts` verbatim, repointing the imports
at `./paths.ts`. Rewrite only the header comment: this is a scope's optional
base prompt, pi's own filename and location, resolved along the chain by pique
because pi discovers only the one `agentDir` it is handed.

Delete both from `profiles/paths.ts` and `profiles/service.ts`, and repoint
`chat/agent.ts`'s `resolveBasePrompt` import. Leave the `profiles/*_test.ts`
cases for the moved functions where they are — Task 7 deletes them with the
rest.

- [x] **Step 3: Verify** — `deno test -A src/lib/scope/ src/lib/profiles/`
      passes, `deno check src/lib/chat/agent.ts` clean.

---

### Task 2: Retarget the surviving integration coverage

**Files:** Create `src/lib/chat/base_prompt_integration_test.ts`; delete
`src/lib/chat/profile_integration_test.ts`

- [x] **Step 1: Write the new test**

Three of the eight cases in `profile_integration_test.ts` are really about the
base prompt, not about profiles. Port them with the `profile:` argument removed
and the profile-body assertions dropped, keeping `withTempHome`,
`writeBasePrompt` and `withAgent`:

```ts
Deno.test(
  "with no SYSTEM.md anywhere, pi's own preamble stands",
  /* systemPromptOf includes "coding assistant operating inside pi" */
);
Deno.test(
  "a scope SYSTEM.md replaces pi's preamble",
  /* SPIKE-BASE-PROMPT present, preamble absent */
);
Deno.test(
  "a workspace inherits root's base prompt",
  /* startAgent({scope:"ws-1"}) sees root's SPIKE-BASE-PROMPT */
);
```

The second and third are the claim `resolveBasePrompt` exists to make — that
root's `SYSTEM.md` reaches a workspace at all — and nothing else in the suite
covers it once `profile_integration_test.ts` is gone. That is the whole reason
this task exists.

- [x] **Step 2: Delete `profile_integration_test.ts`.** The other five cases are
      allowlist and shadowing assertions that describe behaviour this plan
      removes.

- [x] **Step 3: Verify** —
      `deno test -A src/lib/chat/base_prompt_integration_test.ts` passes. It
      fails first against a `startAgent` that still takes `profile` only if you
      typo it; it should pass unchanged before and after Task 3, which is the
      point.

---

### Task 3: Unwire profiles from `startAgent`

**Files:** Modify `src/lib/chat/agent.ts`

- [x] **Step 1: Implement**

In `startAgent`:

- Drop `profile?: string` from `opts`, and the two lines resolving
  `profileName`/`profile`.
- Drop `profileAuthoringTools(scope)` from `customTools` and its import.
- Drop `appendSystemPrompt` from the `DefaultResourceLoader` options. Keep
  `systemPrompt`, now importing `resolveBasePrompt` from `../scope/prompt.ts`.
  Rewrite the comment above it: it no longer describes "the two prompt layers" —
  there is one.
- Drop `tools: profile?.tools` from `createAgentSession`, and the comment about
  not coalescing `undefined` and `[]`.

In `resolveChatDefaults`, drop the `profile` field and its return-type entry.
The `""`-is-a- real-value comment goes with it.

Leave `activeToolNames` and `systemPromptOf` alone (decision 7).

- [x] **Step 2: Verify** — `deno test -A src/lib/chat/` passes, including
      `scope_integration_test.ts` (unaffected: it never passed a profile) and
      `agent_test.ts` (which asserts on `resolveChatDefaults` — update its
      expectations).

---

### Task 4: Remove the picker

**Files:** Modify `src/lib/chat/store.ts`, `src/lib/chat/Chat.svelte`

- [x] **Step 1: `store.ts`**

- Drop `profile` and `profiles` from `ChatSession` and their `writable`s, the
  `profileBindings` import, the `profilesVisible` call in `start()`, and the
  `c?.chat?.defaultProfile` read in the `scopeConfigResolve` handler (the
  `level` read stays).
- Drop `pickProfile`.
- `start()` loses its `profileName` parameter; `restart()` loses its argument
  and its `profileName` pass-through; `newChat()` becomes `restart()`.
- **Keep the generation counter.** It guards the in-flight 20s `chatRead`
  long-poll across _any_ restart, and `newChat` still restarts. Removing it is
  the trap in this task.

- [x] **Step 2: `Chat.svelte`**

- Drop `profile, profiles` from the destructure.
- `pending` narrows to `{ kind: "new" } | null`; the confirm bar keeps only its
  "Starting a new chat leaves this conversation behind" branch and its button
  loses the ternary. `confirmPending` collapses to `session.newChat()`.
- Delete the first `<select>` in the footer row. Model, thinking level, New chat
  remain.

- [x] **Step 3: Verify** — `deno task build` clean; footer renders three
      controls; "New chat" still confirms and still clears the transcript.

---

### Task 5: Bindings

**Files:** Modify `src/lib/chat/bindings.ts`, `src/lib/scope/bindings.ts`,
`src/desktop.ts`

- [x] **Step 1: The contracts**

`chatStart`'s argument loses `profile?: string`; `ScopeConfig["chat"]` loses
`defaultProfile?: string` and its comment.

- [x] **Step 2: The backend**

In `src/desktop.ts`: delete the five `profiles*` `win.bind` handlers and their
section comment, the `let profiles: typeof import(...)` declaration, and the
matching `profiles = await import(...)` line. Drop `profile` from the
`chatStart` handler's destructure and its pass-through comment.

The file-level constraint still holds: **every bind must be registered before
the first top-level `await`.** Deleting binds cannot violate it, but do not
reshuffle the remaining ones while you are in there.

- [x] **Step 3: Verify** — `deno check src/desktop.ts` and `deno task build`
      clean.

---

### Task 6: Settings

**Files:** Modify `src/lib/settings/SettingsModal.svelte`

- [x] **Step 1: Implement**

Delete the `{#if section === "profiles"}` block (currently ~1021–1177), the
`{ id: "profiles", label: "Profiles" }` tab entry, `"profiles"` from
`SCOPED_SECTIONS`, the `profileBindings`/`ProfileInfo` import, and the whole
`profiles` state block — `ownProfiles`, `rootProfiles`, `profileError`,
`profileNotice`, `profileBusy`, `openProfile`, the three `$derived` lists,
`refreshProfiles`, its `$effect`, `profileKey`, `profileAction`.

Check the Prompts section afterwards for comments that say "same shape as
`profileAction`" or similar — those references are about to dangle. Rewrite them
to stand alone rather than deleting the explanation they carry.

- [x] **Step 2: Verify** — `deno task build` clean; the settings modal opens,
      the Prompts section still lists/edits/approves, and no tab 404s.

---

### Task 7: Delete `src/lib/profiles/`, and one sentence in `define_prompt`

**Files:** Delete `src/lib/profiles/`; modify `src/lib/prompts/agent-tools.ts`

- [x] **Step 1: Delete the directory.** All eight files. Nothing should still
      import it — `grep -rn "profiles/" src/` must come back empty before you
      delete, not after.

- [x] **Step 2: `define_prompt`'s description**

It currently reads "it grants no capability and changes no system prompt". Still
true, and now it is the _only_ thing an agent can author to steer a later
session — so the sentence should stop sounding like a caveat against an
alternative that no longer exists. One sentence, no other edits to the tool.

- [x] **Step 3: Verify** — `deno task test` and `deno task build` both clean.

---

### Task 8: Docs

**Files:** Delete `docs/profiles.md`; modify `docs/prompts.md`,
`docs/scopes.md`, `docs/extensions.md`, `README.md`

- [x] **Step 1: `docs/scopes.md`** absorbs the base prompt

Drop the **Profiles** row from the inheritance table; keep the **Base prompt**
row, repointing it at `scope/prompt.ts`. Retitle "Profiles and the base prompt"
→ "The base prompt" and cut it to its second paragraph — pi discovers only the
one `agentDir`, so root's `SYSTEM.md` would be invisible to a workspace, and
`resolveBasePrompt` walking the chain is what makes it inherit. In the Prompt
templates section, "inherit the same way profiles do" needs a new referent: say
local extensions.

- [x] **Step 2: `docs/prompts.md`**

Cut the "A template is **not** a profile" paragraph. Two places lose their
comparison and need the reasoning kept rather than the sentence: "Unlike
profiles — which live _outside_ `agent/`…" becomes a plain statement that
`<agentDir>/prompts/` is where pi looks, and "not baked in at session creation
the way a profile's system prompt is" becomes the same point about pi's system
prompt generally. Deferred #3's cross-reference to `profiles.md` drops to
`extensions.md` alone.

Add a short section — **Steering vs. sending** — carrying decision 3 and
background #1: a template's body arrives as your message, so a permanent
instruction belongs in the scope's `agent/SYSTEM.md` instead, and a profile body
ported across usually needs rewriting rather than copying.

- [x] **Step 3: `docs/extensions.md`**

Three references treat a profile's allowlist as the supported containment story
(terminology table, deferred #4, and "Containment, where you want it, is a
**profile**"). There is no longer a containment story — say that plainly rather
than pointing somewhere else, and fold it into the existing deferred item.

- [x] **Step 4: `README.md`**

Delete the Profile glossary line. The Prompt Template line below it already
stands on its own.

**Do not fix** the System Prompt line above it while you are there, even though
it is wrong — it names `~/.pique/SYSTEM.md` and `~/.pique/workspace/SYSTEM.md`,
while the code has used `~/.pique/scopes/<id>/agent/SYSTEM.md` since scopes
landed. Pre-existing, unrelated, and worth its own commit.

- [x] **Step 5: Delete `docs/profiles.md`** and verify no doc still links to it:
      `grep -rn "profiles.md" docs README.md` comes back empty.

---

### Task 9: Full verification

- [x] `deno task test` — whole suite.
- [x] `deno task build` — clean.
- [x] `grep -rni "profile" src/` — only incidental matches (none expected).
- [x] Manual pass per [docs/agent-verification.md](../../agent-verification.md),
      **web mode only**: the footer shows three controls (model, thinking, New
      chat) and no picker; Settings has no Profiles tab and its Prompts section
      still renders; console clean. The two backend claims — a template saved
      mid-conversation reaching the `/` menu without clearing it, and root's
      `agent/SYSTEM.md` reaching a workspace's agent — are covered by
      `chat/prompt_integration_test.ts` and
      `chat/base_prompt_integration_test.ts` instead, since Chat needs the
      desktop backend.
- [ ] Ask an agent to call `define_prompt`, approve it in Settings, invoke it as
      `/name`. **Not run** — needs the desktop app (`deno task dev`), which
      cannot be driven from the Browser pane. Covered automatically by
      `chat/prompt_integration_test.ts`.
- [x] Confirm an existing `~/.pique/scopes/*/profiles/` dir is left untouched on
      disk and that nothing reads it (decision 3). No such dir exists on this
      machine, so there was nothing to strand.

---

## Deferred

1. **Per-template tool restriction.** `tools:` frontmatter applied on invoke
   through `session.setActiveToolsByName()` — pi ignores unknown frontmatter
   keys, and the call takes effect on the next turn, so this would need no
   restart and would be strictly better than the profile allowlist it replaces.
   Needs two decisions this plan does not make: whether the narrowing is sticky
   for the conversation or one turn, and where the full tool set is snapshotted
   from to restore it.
2. **A per-scope default steer.** `chat.defaultProfile` is gone;
   `agent/SYSTEM.md` is the replacement, and editing it has no UI.
3. **Rejected-template memory.** Unchanged and now recorded in one place instead
   of three ([prompts.md](../../prompts.md) deferred #3).

---

## Deviations found during implementation

1. **`basePromptPath`'s own unit test moved too.** The plan listed only the
   three `resolveBasePrompt` resolution cases; `profiles/paths_test.ts` also had
   a path-shape case for `basePromptPath`, which followed it into
   `scope/prompt_test.ts`.
2. **Two store tests were dropped, not ported.** "A new chat keeps the profile
   in use" and "picking the profile already in use does nothing" describe
   behaviour that no longer exists. "Picking a profile restarts the agent"
   became "a new chat drops the transcript the old agent streamed", and the
   generation-guard test now restarts via `newChat` — the counter itself stayed,
   per Task 4.
3. **`docs/scopes.md` gained a Prompt templates row** in the inheritance table.
   The table never listed templates, only Profiles and Base prompt; removing the
   Profiles row would have left the primary artifact absent from the one table
   that says how things inherit.
4. **`extensions.md` deferred #1 absorbed the containment gap** rather than only
   losing its pointer. It now says outright that restricting an agent's tool set
   is unbuilt, and that pi still offers `allowedToolNames` /
   `setActiveToolsByName` — what is missing is anything in pique deciding what
   to pass.
5. **Four stale comments in `src/lib/prompts/` were rewritten.** They explained
   the module by contrast with `profiles/` ("shaped on profiles/service.ts",
   "unlike profiles, these live inside agent/"). The reasoning was kept and the
   referent dropped, rather than deleting the explanation with the reference.
6. **Historical plans and specs still name profiles.** `docs/superpowers/`
   records what was true when each was written, so the 2026-07-28 profiles pair
   and the unified-extensions spec were left alone. Task 8's "grep comes back
   empty" therefore holds for live docs only.
7. **The repo is not `deno fmt` clean, before or after.** 111 unformatted files
   beforehand, 102 after (the drop is deleted files). `deno lint` likewise
   reports 21 → 20 pre-existing problems. No formatter was run: doing so would
   bury this change in an unrelated diff. `deno task test` and `deno task build`
   are the real gates and both pass.
