# Agent Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human or an agent define a **profile** — a named base prompt plus an allowlist of tools, stored as one markdown file with frontmatter — and run a Chat module under it.

**Architecture:** A profile is data, not code. `scopes/<id>/profiles/<name>.md` holds the tool allowlist in frontmatter and prompt text in the body; the filename is the name. `startAgent` resolves the chosen profile along `chain(scope)` and hands pi two options it already has: `tools` (a hard allowlist over builtins, extension tools and pique's compiled-in tools alike) and `appendSystemPrompt` (the body). A scope's optional `agent/SYSTEM.md` is resolved the same way and passed as `systemPrompt`, so the base prompt is replaceable without touching profiles. Agents get `define_profile`, which can only write into `profiles/pending/` — approving is a rename, exactly as with defined tools.

**Design doc:** [2026-07-28-agent-profiles-design.md](../specs/2026-07-28-agent-profiles-design.md)

**Tech Stack:** Deno, `@earendil-works/pi-coding-agent`, `jsr:@std/front-matter`, Svelte 5 (runes), Tailwind + daisyUI, `deno test`.

---

## Background: what pi gives us, verified

A spike on 2026-07-28 drove the real SDK under Deno and asserted on the resulting session:

- `createAgentSession({ tools })` becomes `allowedToolNames`, applied in `_refreshToolRegistry`.
  An excluded tool is absent from the registry, and a later `setActiveToolsByName` — the same
  entry point extensions reach through `setActiveTools` — **cannot** re-enable it.
- `DefaultResourceLoader({ systemPrompt })` replaces pi's preamble but keeps project context
  files, the skills section and the cwd line. `appendSystemPrompt: string[]` keeps the preamble
  and appends.
- `session.getAllTools()` returns `{ name, sourceInfo.source }` for every registered tool
  (`builtin` / `sdk` / `extension`), but only from a live session.
- `jsr:@std/front-matter@^1/yaml`'s `extract` parses the intended format. It **throws** on a
  file with no frontmatter (`TypeError: Unexpected end of input`) and on malformed YAML
  (`SyntaxError`), so both are caller problems — see Task 2.

## Decisions locked in before coding

Settled in the design doc. Do not re-litigate them mid-task.

1. **Two prompt layers.** Base (`agent/SYSTEM.md`, optional) → `systemPrompt`; profile body →
   `appendSystemPrompt`. Neither present is today's behaviour, unchanged.
2. **The filename is the name.** No `name:` frontmatter key, so the two cannot disagree.
3. **`tools:` omitted ≠ `tools: []`.** Omitted → no allowlist (pi's default set plus every
   extension and custom tool). `[]` → an agent with no tools at all. Pass `undefined` for the
   first and `[]` for the second; `??` must not collapse them.
4. **A profile narrows, never widens.** The allowlist filters what the scope already loaded;
   a name that resolves to nothing is silently ignored by pi. That is deliberate — it is what
   lets a root profile naming a workspace's tool degrade instead of failing.
5. **Profiles live outside `agent/`.** pi auto-discovers `SYSTEM.md`, `extensions/*.ts` and
   skills under `agentDir`; `profiles/` must not be somewhere pi will interpret it.
6. **Listing never recurses.** `profiles/*.md` only, so `profiles/pending/` can never be
   selected. Location is the approval record, as in `tools/paths.ts`.
7. **The agent's rationale goes in frontmatter,** not the body. The body becomes system-prompt
   text for a later model; the rationale is for the human reviewing it.
8. **Switching profile restarts the conversation.** `AgentSession` has `get systemPrompt` and
   no setter, so there is no honest alternative.

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `src/lib/profiles/paths.ts` | New | Every profile path, keyed by scope; the name rule |
| `src/lib/profiles/parse.ts` | New | Pure text → `Profile`; the only module that knows the file format |
| `src/lib/profiles/service.ts` | New | List / read / approve / reject / revoke, and resolution along `chain()` |
| `src/lib/profiles/agent-tools.ts` | New | `define_profile`, writing into `pending/` only |
| `src/lib/profiles/bindings.ts` | New | Frontend half of the `profile*` contract |
| `src/lib/chat/agent.ts` | Modify | `startAgent` takes a profile and applies both halves |
| `src/lib/chat/bindings.ts` | Modify | `chatStart` gains `profile` |
| `src/lib/chat/store.ts` | Modify | Profile store, `pickProfile`, generation-guarded restart |
| `src/lib/chat/Chat.svelte` | Modify | Profile picker plus its confirm |
| `src/lib/scope/bindings.ts` | Modify | `chat.defaultProfile` on `ScopeConfig` |
| `src/desktop.ts` | Modify | `profile*` `win.bind` handlers |
| `src/lib/settings/SettingsModal.svelte` | Modify | Profiles tab |
| `deno.json` | Modify | `@std/front-matter` import |
| `docs/profiles.md` | New | The feature doc, shaped like `defined-tools.md` |
| `docs/scopes.md` | Modify | Inheritance table row and a Profiles section |

---

### Task 1: Paths and the name rule

**Files:** Create `src/lib/profiles/paths.ts`, `src/lib/profiles/paths_test.ts`

- [ ] **Step 1: Write the failing tests**

Mirror `src/lib/tools/paths_test.ts`. Cover: `profilePath` and `pendingProfilePath` land under
the right scope dir; `assertProfileName` accepts `reviewer` and `code-reviewer`; it rejects
`../escape`, `a/b`, `Reviewer` (uppercase), `-lead` (leading dash) and `""`.

- [ ] **Step 2: Implement**

```ts
// On-disk locations for profiles — a named base prompt plus a tool allowlist, one
// markdown file each (see docs/profiles.md). Two dirs inside a scope:
//
//   profiles/          LIVE. Selectable in a Chat module.
//   profiles/pending/  QUARANTINE. Agent-authored; nothing here is ever selectable,
//                      because every listing globs profiles/*.md without recursing.
//
// Deliberately OUTSIDE the scope's agent/ dir: pi auto-discovers SYSTEM.md, extensions
// and skills under agentDir, and a directory of markdown there invites it to interpret
// them. Runs Deno-side only.
import { scopeAgentDir, scopeDir, type ScopeId } from "../scope/paths.ts";

// A profile name is a filename AND a human-facing label, so it allows dashes where a
// tool name (tools/paths.ts) allows underscores — but is constrained the same way, so
// a name can never escape its directory.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function profilesDir(scope: ScopeId): string {
  return `${scopeDir(scope)}/profiles`;
}

export function pendingDir(scope: ScopeId): string {
  return `${profilesDir(scope)}/pending`;
}

// This scope's optional base prompt. pi's own filename and location: a user who already
// knows pi drops SYSTEM.md here and it works. pi only ever discovers the ONE agentDir it
// was given, so inheriting root's is service.ts's job (resolveBasePrompt).
export function basePromptPath(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/SYSTEM.md`;
}

export function assertProfileName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid profile name: ${name}`);
}

export function profilePath(scope: ScopeId, name: string): string {
  assertProfileName(name);
  return `${profilesDir(scope)}/${name}.md`;
}

export function pendingProfilePath(scope: ScopeId, name: string): string {
  assertProfileName(name);
  return `${pendingDir(scope)}/${name}.md`;
}

export async function ensureProfileDirs(scope: ScopeId): Promise<void> {
  await Deno.mkdir(pendingDir(scope), { recursive: true });
}
```

- [ ] **Step 3: Verify** — `deno test -A src/lib/profiles/paths_test.ts` passes.

---

### Task 2: The file format

**Files:** Modify `deno.json`; create `src/lib/profiles/parse.ts`, `src/lib/profiles/parse_test.ts`

- [ ] **Step 1: Add the dependency**

In `deno.json` `imports`, next to the other `@std/*` entries:

```json
    "@std/front-matter": "jsr:@std/front-matter@^1",
```

- [ ] **Step 2: Write the failing tests**

The cases that matter, all pure:

```ts
Deno.test("parses frontmatter and body", () => {
  const p = parseProfile("reviewer", "---\ndescription: Reads only\ntools: [read, grep]\n---\n\nBe careful.\n");
  assertEquals(p.description, "Reads only");
  assertEquals(p.tools, ["read", "grep"]);
  assertEquals(p.body, "Be careful.");
});

Deno.test("a file with no frontmatter is all body", () => {
  const p = parseProfile("plain", "Just prompt text.\n");
  assertEquals(p.tools, undefined);
  assertEquals(p.body, "Just prompt text.");
});

Deno.test("omitted tools and an empty list are different", () => {
  assertEquals(parseProfile("a", "---\ndescription: x\n---\nbody").tools, undefined);
  assertEquals(parseProfile("b", "---\ntools: []\n---\nbody").tools, []);
});

Deno.test("malformed yaml is reported, not thrown", () => {
  const p = parseProfile("bad", "---\ntools: [a, b\n---\nbody");
  assertEquals(typeof p.error, "string");
});

Deno.test("a non-list tools value is reported", () => {
  assertEquals(typeof parseProfile("bad", "---\ntools: read\n---\nbody").error, "string");
});

Deno.test("unknown keys are ignored", () => {
  assertEquals(parseProfile("x", "---\nfuture: 1\n---\nbody").body, "body");
});
```

- [ ] **Step 3: Implement**

```ts
// The profile file format, and nothing else: frontmatter (a tool allowlist plus a
// description) over a markdown body that becomes appended system-prompt text. Pure —
// no filesystem, no pi — so the format is testable on its own.
import { extract } from "@std/front-matter/yaml";

export interface Profile {
  name: string;
  description?: string;
  // The tool allowlist. UNDEFINED and [] mean different things and must stay distinct:
  // undefined is "no allowlist" (pi's default set plus every extension and custom tool),
  // [] is "no tools at all". See docs/profiles.md.
  tools?: string[];
  // Rationale recorded by define_profile. Shown to the reviewer; never sent to a model,
  // which is why it lives here rather than in the body.
  rationale?: string;
  body: string;
  // Set when the frontmatter could not be used. The profile is still returned (with its
  // body) so the UI can show what is wrong instead of silently hiding the file.
  error?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function parseProfile(name: string, text: string): Profile {
  let attrs: Record<string, unknown> = {};
  let body = text;
  try {
    // Throws on a file with no frontmatter, and on malformed YAML. The first is normal
    // (a profile may be prompt text alone); the second is an error worth surfacing.
    const extracted = extract(text);
    attrs = extracted.attrs as Record<string, unknown>;
    body = extracted.body;
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      return { name, body: text.trim(), error: `frontmatter: ${(err as Error).message}` };
    }
  }
  const raw = attrs.tools;
  const bad = raw !== undefined && !(Array.isArray(raw) && raw.every((t) => typeof t === "string"));
  return {
    name,
    description: str(attrs.description),
    rationale: str(attrs.rationale),
    tools: bad ? undefined : (raw as string[] | undefined),
    body: body.trim(),
    error: bad ? "tools must be a list of tool names" : undefined,
  };
}
```

- [ ] **Step 4: Verify** — `deno test -A src/lib/profiles/parse_test.ts` passes.

---

### Task 3: The service

**Files:** Create `src/lib/profiles/service.ts`, `src/lib/profiles/service_test.ts`

- [ ] **Step 1: Write the failing tests**

Use the `withTempHome` helper from `src/lib/chat/scope_integration_test.ts` (copy it; the
other test files each carry their own). Cover:

- `listProfiles(scope)` returns live and pending separately; `pending/` never appears as live.
- `listVisibleProfiles("ws-1")` returns root's plus its own, root-first.
- A same-named profile in `ws-1` **shadows** root's in `listVisibleProfiles` and in
  `resolveProfile`, and root's is unreachable from `ws-1` under that name.
- `resolveProfile(ROOT, "x")` cannot see `ws-1`'s.
- `resolveProfile` on a missing name returns `null` (a stale scope default must not throw).
- `approveProfile` moves pending → live; `rejectProfile` and `revokeProfile` delete.
- `resolveBasePrompt("ws-1")` returns `ws-1`'s `SYSTEM.md` when present, root's when not,
  and `undefined` when neither exists.

- [ ] **Step 2: Implement**

Shape it on `src/lib/tools/service.ts` — same `namesIn` treatment of a missing dir (return
`[]`, it means "none yet"), same `chain()` walk. Two things it does that the tools service
does not:

```ts
export type ProfileState = "live" | "pending";
export interface ProfileInfo extends Profile { scope: ScopeId; state: ProfileState }

// Resolution walks the chain NEAREST FIRST — the reverse of listing — so a workspace's
// profile shadows a root profile of the same name. Missing → null, so a scope default
// left pointing at a deleted profile degrades to "no profile" rather than throwing.
export async function resolveProfile(scope: ScopeId, name: string): Promise<Profile | null>;

// The scope's base prompt, nearest first, or undefined when no SYSTEM.md exists anywhere
// on the chain. Undefined must reach pi as undefined — that is what keeps pi's own
// preamble as the default.
export async function resolveBasePrompt(scope: ScopeId): Promise<string | undefined>;
```

`listVisibleProfiles` returns root-first (matching `listVisibleTools`, which the Settings UI
relies on for ordering) but must **drop shadowed duplicates**, keeping the nearest — otherwise
the picker shows one name twice.

- [ ] **Step 3: Verify** — `deno test -A src/lib/profiles/service_test.ts` passes.

---

### Task 4: `define_profile`

**Files:** Create `src/lib/profiles/agent-tools.ts`, `src/lib/profiles/agent-tools_test.ts`

- [ ] **Step 1: Write the failing tests**

Mirror `src/lib/tools/agent-tools_test.ts`: calling the tool writes `pending/<name>.md` and
**nothing** into `profiles/`; an invalid name throws; the rationale lands in frontmatter and
not in the body; `tools` round-trips through `parseProfile`.

- [ ] **Step 2: Implement**

Model it on `toolAuthoringTools` — same scope binding, same `reach` sentence in the
description, same "not usable until approved" wording in both the description and the return
text. Parameters: `name`, `description`, `prompt` (the body), `tools` (`Type.Optional` array of
strings), `rationale`.

Serialise the frontmatter by hand rather than pulling in a YAML **writer**: the schema is four
scalar-or-string-list keys, and `JSON.stringify` on the array is valid YAML flow sequence
syntax. Assert the name first, then `ensureProfileDirs`, then write.

The description must state the two things the agent cannot infer: that the profile is inert
until a human approves it in Settings → Profiles, and that `tools` can only ever **narrow**
what a session already has (decision 4), so listing a tool that does not exist is a silent
no-op rather than a grant.

- [ ] **Step 3: Verify** — `deno test -A src/lib/profiles/agent-tools_test.ts` passes.

---

### Task 5: Wire profiles into `startAgent`

**Files:** Modify `src/lib/chat/agent.ts`; create `src/lib/chat/profile_integration_test.ts`

- [ ] **Step 1: Write the failing integration test**

This is the claim the feature exists to make, so it goes through the real `startAgent`, in the
shape of `scope_integration_test.ts`. Reuse that file's `withTempHome` and `extensionSource`
helpers. Add `activeToolNames`-style access to the prompt — `startAgent` should expose a small
`systemPromptOf(id)` alongside `activeToolNames(id)` for this (it reads `session.systemPrompt`).

```ts
Deno.test("a profile's allowlist restricts the agent's tools", async () => {
  await withTempHome(async () => {
    await writeProfile(ROOT, "reader", "---\ntools: [read, grep]\n---\nRead only.\n");
    const id = await startAgent({ scope: ROOT, profile: "reader" });
    try {
      const tools = activeToolNames(id);
      assertEquals(tools.includes("read"), true);
      assertEquals(tools.includes("bash"), false, "an excluded builtin must be gone");
      assertEquals(tools.includes("define_tool"), false, "pique's own tools are filtered too");
    } finally { stopAgent(id); }
  });
});

Deno.test("no profile leaves today's tool set untouched", /* define_tool + bash present */);
Deno.test("a profile body is appended to the system prompt", /* body text present AND pi's preamble still present */);
Deno.test("a scope SYSTEM.md replaces the preamble, and the body still appends", /* both assertions */);
Deno.test("a workspace inherits root's profiles", /* startAgent({scope:"ws-1", profile:"reader"}) restricts */);
Deno.test("a missing profile falls back to no profile", /* startAgent({profile:"ghost"}) === today's tools */);
Deno.test("tools: [] yields an agent with no tools", /* activeToolNames is empty */);
```

- [ ] **Step 2: Implement**

In `startAgent`, after the existing `resolveScopeConfig` call:

```ts
  // Absent `profile` means "use the scope's default"; an explicit "" means "no profile",
  // which is why this uses ?? and not ||. A name that no longer resolves degrades to no
  // profile, the same way an unavailable model falls back.
  const profileName = opts.profile ?? resolveChatDefaults(config).profile ?? "";
  const profile = profileName ? await resolveProfile(scope, profileName) : null;
```

Pass `systemPrompt: await resolveBasePrompt(scope)` and
`appendSystemPrompt: profile?.body ? [profile.body] : undefined` to the `DefaultResourceLoader`
constructor, and `tools: profile?.tools` to `createAgentSession`. `profile?.tools` is
`undefined` for both "no profile" and "profile without a `tools:` key" — which is correct, and
is decision 3: do not coalesce it to `[]`.

Extend `resolveChatDefaults` with `profile: str(chat.defaultProfile, "")`, guarded like the
other three fields.

- [ ] **Step 3: Verify** — `deno test -A src/lib/chat/` passes, `scope_integration_test.ts`
      included (it must be unaffected: no profile means no behaviour change).

---

### Task 6: Bindings

**Files:** Create `src/lib/profiles/bindings.ts`; modify `src/desktop.ts`, `src/lib/chat/bindings.ts`, `src/lib/scope/bindings.ts`

- [ ] **Step 1: The frontend contract**

`src/lib/profiles/bindings.ts`, shaped exactly like `src/lib/tools/bindings.ts` (same header
comment about the two halves being kept in sync by hand):

```ts
export interface ProfileBindings {
  profilesList(arg: { scope: string }): Promise<ProfileInfo[]>;   // this scope's own
  profilesVisible(arg: { scope: string }): Promise<ProfileInfo[]>; // plus inherited, shadowed dropped
  profilesApprove(arg: { scope: string; name: string }): Promise<unknown>;
  profilesReject(arg: { scope: string; name: string }): Promise<unknown>;
  profilesRevoke(arg: { scope: string; name: string }): Promise<unknown>;
}
```

Add `profile?: string` to `ChatBindings.chatStart`'s argument in `src/lib/chat/bindings.ts`,
and `defaultProfile?: string` to `ScopeConfig["chat"]` in `src/lib/scope/bindings.ts`.

- [ ] **Step 2: The backend handlers**

In `src/desktop.ts`: a `let profiles: typeof import("./lib/profiles/service.ts");` declaration
beside the others, five `win.bind` handlers in the style of the `tools*` block, and the
matching `profiles = await import(...)` line in the trailing import section. **All binds must
be registered before the first top-level `await`** — the constraint documented at the top of
that file. Thread `profile` through the existing `chatStart` handler.

- [ ] **Step 3: Verify** — `deno check src/desktop.ts` and `deno task build` both clean.

---

### Task 7: The picker

**Files:** Modify `src/lib/chat/store.ts`, `src/lib/chat/Chat.svelte`

- [ ] **Step 1: Restart, guarded by a generation counter**

`start()` gains a profile argument and a generation guard. **This is the trap in this task:**
`alive` alone is not enough. Setting `alive = false` does not stop the in-flight `chatRead`
long-poll, which can hang for up to 20s; by the time it resolves, `start()` has set
`alive = true` again and the old loop would resume applying the **old agent's** events into the
**new** transcript. Bind a generation at loop start and break when it changes:

```ts
  let generation = 0;
  function start(profileName: string) {
    const gen = ++generation;
    ...
    while (alive && gen === generation) { ... }
  }
```

Then:

```ts
  // Switching profile cannot be applied to a live agent — pi fixes the system prompt at
  // session creation — so this stops the old agent and starts a new one, which is why the
  // transcript is cleared. The pick becomes the scope's default, like pickModel's does.
  async pickProfile(name: string) {
    if (name === get(profile)) return;
    if (id) b?.chatStop({ id }).catch(() => {});
    id = undefined;
    alive = false;
    items.set([]);
    streaming.set(false);
    ready.set(false);
    profile.set(name);
    patchScopeChat(scope, { defaultProfile: name });
    start(name);
  }
```

Add a `profile: Writable<string>` to `ChatSession`, seeded from the same
`scopeConfigResolve` call that already corrects `level`, and a `profiles: Writable<ProfileInfo[]>`
filled from `profilesVisible({ scope })` on start.

- [ ] **Step 2: The control**

In `Chat.svelte`'s footer row, a `<select>` before the model picker: a `— no profile —` option
with value `""` plus one option per visible profile (label = name, `title` = description).

Switching discards the transcript, so it needs a confirm. Do **not** use `window.confirm` —
behaviour under the desktop webview is unverified. Instead let the change handler stash the
pending choice and render an inline bar above the footer ("Switching to **reviewer** starts a
new conversation. [Switch] [Cancel]"), reverting the `<select>` binding on cancel. Disable the
picker while `!$ready || $streaming`, matching the sibling controls.

- [ ] **Step 3: Verify** — drive the app per [docs/agent-verification.md](../../agent-verification.md):
      switch profiles, confirm the transcript clears, confirm a `tools:`-restricted profile
      makes the agent refuse a shell task, and confirm the choice survives a restart of the app.

---

### Task 8: Settings → Profiles

**Files:** Modify `src/lib/settings/SettingsModal.svelte`

- [ ] **Step 1: Implement**

Add `{ id: "profiles", label: "Profiles" }` to the tab list after `tools`, and a section that
mirrors the Tools section closely enough that the two read as siblings:

- Pending profiles first, each expandable to show `rationale`, `tools` and the body, with
  **Approve** / **Reject**. As in Tools, Approve enables only once the body has been expanded.
- Live profiles below, with **Revoke**.
- Inherited profiles last, read-only, labelled with the scope they come from.
- A profile whose `error` is set shows it inline — a broken file must be visible, not hidden.
- The section is per-scope and uses the existing scope selector; in web-dev mode it shows the
  same desktop-only note as Tools.

- [ ] **Step 2: Verify** — `deno task build` clean; the tab renders and approve/reject/revoke
      move files as expected under `~/.pique/scopes/<id>/profiles/`.

---

### Task 9: Docs

**Files:** Create `docs/profiles.md`; modify `docs/scopes.md`, `docs/defined-tools.md`

- [ ] **Step 1: `docs/profiles.md`**

Shape it like `defined-tools.md`: where profiles come from, the two directories, the file
format, the flow, what the gate is and is not, then a Deferred section carrying the design
doc's five items. It must state plainly:

- `tools:` omitted vs `tools: []` (decision 3).
- That the allowlist is real enforcement — unlike the defined-tools approval gate — **but**
  that allowing `bash` allows everything, so a read-only profile must exclude `bash`, `write`
  and `edit` together.
- That a tool name resolving to nothing is a silent no-op.

- [ ] **Step 2: `docs/scopes.md`**

Two rows in the "How each thing inherits" table (`Profiles` — nearest scope wins; `Base prompt`
— nearest `SYSTEM.md` wins) and a short section explaining that `SYSTEM.md` is resolved by
pique rather than by pi, because pi only ever discovers the one `agentDir`.

- [ ] **Step 3: `docs/defined-tools.md`**

One note in "What the gate is and is not": a profile's allowlist *is* containment, and is the
supported way to run an agent that cannot write — which is deferred item #1 approached from the
other side.

---

### Task 10: Full verification

- [ ] `deno task test` — the whole suite, including the untouched `scope_integration_test.ts`.
- [ ] `deno task build` — clean.
- [ ] Manual pass per [docs/agent-verification.md](../../agent-verification.md): define a profile
      by hand in root, see it in a workspace's picker, run under it, and confirm through the
      transcript that an excluded tool is genuinely unavailable rather than merely discouraged.
- [ ] Ask an agent to call `define_profile`, then approve it in Settings and run under it.
