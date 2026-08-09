# Library Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the Library module's Extensions / Prompts / Skills sub-tabs
into one list grouped by state (Awaiting review → Active → Inherited from Root),
with the pi catalog search promoted to the top of the module.

**Architecture:** Each kind keeps a pure TS mapper in its own directory that
turns its binding's response into a shared `LibraryItem`, and a Svelte component
for its expanded-row detail. `library/Library.svelte` owns the single fetch, the
grouping, the row chrome, the action dispatch and the Add bar, switching on
`item.kind` where the kinds genuinely differ. No service, binding or
`desktop.ts` handler changes at all.

**Tech Stack:** Deno 2, Svelte 5 (runes: `$state`, `$derived`, `$props`,
`$effect`), Tailwind 4 + daisyUI 5, `@std/assert` for tests.

**Spec:**
[2026-08-08-library-unification-design.md](../specs/2026-08-08-library-unification-design.md)

---

## Orientation

Read these before starting. You do not need to change any of them.

| File                                   | Why                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `src/lib/library/Library.svelte`       | The shell you will rewrite in Task 6                                            |
| `src/lib/extensions/Extensions.svelte` | 438 lines; Tasks 5 and 6 lift code out of it verbatim                           |
| `src/lib/prompts/Prompts.svelte`       | 330 lines; same                                                                 |
| `src/lib/skills/Skills.svelte`         | 78 lines; same                                                                  |
| `src/lib/extensions/bindings.ts`       | The `ExtensionBindings` interface and the `Extension` / `ExtensionSource` types |
| `src/lib/prompts/bindings.ts`          | `PromptBindings`, `PromptInfo`                                                  |
| `src/lib/skills/bindings.ts`           | `SkillBindings`, `SkillInfo`                                                    |
| `src/lib/scope/paths.ts`               | `ROOT`, `ScopeId`, `chain`                                                      |

**Facts you will need, so you do not have to go looking:**

- `Extension` is
  `{ id, name, origin: "local" | "package", state: "pending" | "enabled", scope, source?, path? }`.
- `PromptInfo` is
  `{ name, description, argumentHint?, rationale?, body, error?, scope, state: "live" | "pending" }`.
- `SkillInfo` is `{ name, description, path, scope, frontmatterName?, error? }`.
- All three `*Bindings()` factories read the same `globalThis.bindings` object
  and return `null` in web mode (`deno task web`), where there is no desktop
  backend.
- **Import types from `bindings.ts`, never from `service.ts`.** `service.ts`
  modules run Deno-side and call `Deno.readDir` and friends; `bindings.ts`
  re-exports their types with `import type`, which the bundler erases. A value
  import from `service.ts` would break the vite build.
- Tests run with `deno task test`, which is `deno test -A src/`. Test style in
  this repo: `Deno.test("a sentence describing the behaviour", () => { ... })`
  with `@std/assert`.
- `deno lint` reports ~30 pre-existing problems. It is not a gate; the count
  must not grow.

---

## File Structure

| File                                        | Change  | Responsibility                                                            |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `src/lib/library/items.ts`                  | Create  | The `LibraryItem` union and the group/sort — what every row has in common |
| `src/lib/library/items_test.ts`             | Create  | Grouping and sort order                                                   |
| `src/lib/extensions/items.ts`               | Create  | `Extension[]` → `LibraryItem[]`                                           |
| `src/lib/extensions/items_test.ts`          | Create  | Extension state mapping                                                   |
| `src/lib/prompts/items.ts`                  | Create  | `PromptInfo[]` → `LibraryItem[]`, plus the `Draft` type                   |
| `src/lib/prompts/items_test.ts`             | Create  | Prompt state mapping and shadowing                                        |
| `src/lib/skills/items.ts`                   | Create  | `SkillInfo[]` → `LibraryItem[]`                                           |
| `src/lib/skills/items_test.ts`              | Create  | Skill state mapping and notes                                             |
| `src/lib/extensions/ExtensionReview.svelte` | Create  | The review pane, presentation only                                        |
| `src/lib/prompts/PromptDetail.svelte`       | Create  | A template's rationale and body, read-only                                |
| `src/lib/prompts/PromptEditor.svelte`       | Create  | The create/edit form                                                      |
| `src/lib/skills/SkillDetail.svelte`         | Create  | A skill's path and description                                            |
| `src/lib/library/Library.svelte`            | Rewrite | Fetch, groups, rows, actions, Add bar                                     |
| `src/lib/extensions/Extensions.svelte`      | Delete  | Replaced by the above                                                     |
| `src/lib/prompts/Prompts.svelte`            | Delete  | Replaced by the above                                                     |
| `src/lib/skills/Skills.svelte`              | Delete  | Replaced by the above                                                     |

---

## Task 1: The shared item model

**Files:**

- Create: `src/lib/library/items.ts`
- Test: `src/lib/library/items_test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/library/items_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { groupItems, type LibraryItem, type LibraryState } from "./items.ts";

// Minimal fixtures. The per-kind payloads are only carried, never read, by this module,
// so they hold just enough to satisfy the types.
function ext(title: string, state: LibraryState): LibraryItem {
  return {
    kind: "extension",
    key: `extension/root/${title}`,
    scope: "root",
    state,
    title,
    ext: {
      id: title,
      name: title,
      origin: "local",
      state: state === "pending" ? "pending" : "enabled",
      scope: "root",
    },
  };
}

function prompt(title: string, state: LibraryState): LibraryItem {
  return {
    kind: "prompt",
    key: `prompt/root/${title}`,
    scope: "root",
    state,
    title,
    prompt: {
      name: title,
      description: "",
      body: "",
      scope: "root",
      state: state === "pending" ? "pending" : "live",
    },
  };
}

function skill(title: string, state: LibraryState): LibraryItem {
  return {
    kind: "skill",
    key: `skill/root/${title}`,
    scope: "root",
    state,
    title,
    skill: {
      name: title,
      description: "",
      path: `/tmp/${title}`,
      scope: "root",
    },
  };
}

const titles = (items: LibraryItem[]): string[] => items.map((i) => i.title);

// The whole point of unifying: a pending prompt and a pending extension are one queue,
// not two lists you have to switch tabs between to see.
Deno.test("groups by state, mixing kinds within a group", () => {
  const groups = groupItems([
    skill("alpha", "active"),
    prompt("beta", "pending"),
    ext("gamma", "pending"),
    ext("delta", "inherited"),
  ]);
  assertEquals(titles(groups.pending), ["gamma", "beta"]);
  assertEquals(titles(groups.active), ["alpha"]);
  assertEquals(titles(groups.inherited), ["delta"]);
});

// Kind-first ordering keeps a row's neighbours stable as items come and go, which a
// pure alphabetical sort would not.
Deno.test("within a group, extensions come before prompts before skills", () => {
  const groups = groupItems([
    skill("aaa", "active"),
    prompt("bbb", "active"),
    ext("ccc", "active"),
  ]);
  assertEquals(titles(groups.active), ["ccc", "bbb", "aaa"]);
});

Deno.test("ties within a kind break by title", () => {
  const groups = groupItems([
    ext("zebra", "active"),
    ext("apple", "active"),
    ext("mango", "active"),
  ]);
  assertEquals(titles(groups.active), ["apple", "mango", "zebra"]);
});

Deno.test("an empty library yields three empty groups", () => {
  const groups = groupItems([]);
  assertEquals(groups.pending, []);
  assertEquals(groups.active, []);
  assertEquals(groups.inherited, []);
});

// groupItems must not reorder its input in place: Library.svelte holds `items` in
// $state and derives the groups from it, so a mutating sort would shuffle the source
// of truth on every render.
Deno.test("grouping does not mutate the input array", () => {
  const input = [ext("zebra", "active"), ext("apple", "active")];
  groupItems(input);
  assertEquals(titles(input), ["zebra", "apple"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/library/items_test.ts` Expected: FAIL —
`Module not found "./items.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/library/items.ts`:

```ts
// The one shape the Library list renders, and the grouping it renders in. Each kind's
// mapping INTO this shape lives in that kind's own directory (extensions/items.ts and
// so on), beside the bindings it reads; this module knows only what every row has in
// common. Pure — no fetching, no Deno APIs — so it is testable and safe to bundle.
import type { ScopeId } from "../scope/paths.ts";
import type { Extension } from "../extensions/bindings.ts";
import type { PromptInfo } from "../prompts/bindings.ts";
import type { SkillInfo } from "../skills/bindings.ts";

export type LibraryKind = "extension" | "prompt" | "skill";

// What the row is waiting for, NOT what kind of thing it is. `pending` is the review
// gate; `inherited` came from an ancestor scope and is read-only here, because it is
// enabled and revoked where it lives.
export type LibraryState = "pending" | "active" | "inherited";

type Common = {
  // `${kind}/${scope}/${identifier}` — the extension's `id`, the prompt's `name`, the
  // skill's `path`. Unique across kinds AND scopes, which is what the expanded-row
  // state keys on: the same name can exist in root and in a workspace, and expanding
  // one must not expand the other.
  key: string;
  scope: ScopeId;
  state: LibraryState;
  title: string;
  subtitle?: string;
  // An extension's origin, or a prompt's "shadowed" marker. Not the kind — the row
  // renders that from `kind` itself.
  badge?: string;
  // Two severities, because the existing UI has two. `problem` is red: a template or a
  // skill whose frontmatter would not parse. `note` is dim: a skill whose frontmatter
  // `name:` disagrees with the basename an automaton has to use. Collapsing them would
  // either shout about a naming quirk or whisper about a broken file.
  problem?: string;
  note?: string;
};

// A discriminated union rather than a common record with a `source: A | B | C` field:
// the shell's `{#if item.kind === ...}` branches then narrow to the right payload, so
// reaching for `item.ext` inside the prompt branch is a type error rather than a
// runtime undefined.
export type LibraryItem =
  | (Common & { kind: "extension"; ext: Extension })
  | (Common & { kind: "prompt"; prompt: PromptInfo })
  | (Common & { kind: "skill"; skill: SkillInfo });

const KIND_ORDER: Record<LibraryKind, number> = {
  extension: 0,
  prompt: 1,
  skill: 2,
};

export type LibraryGroups = {
  pending: LibraryItem[];
  active: LibraryItem[];
  inherited: LibraryItem[];
};

// Copied before sorting: the caller holds `items` in $state and derives groups from it,
// so sorting in place would shuffle the source of truth on every render.
function sorted(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title)
  );
}

export function groupItems(items: LibraryItem[]): LibraryGroups {
  return {
    pending: sorted(items.filter((i) => i.state === "pending")),
    active: sorted(items.filter((i) => i.state === "active")),
    inherited: sorted(items.filter((i) => i.state === "inherited")),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A src/lib/library/items_test.ts` Expected: PASS — 5 passed.

- [ ] **Step 5: Format and commit**

```bash
deno fmt src/lib/library/ && git add src/lib/library/items.ts src/lib/library/items_test.ts && git commit -m "Add the shared LibraryItem model and its grouping"
```

---

## Task 2: The extension mapper

**Files:**

- Create: `src/lib/extensions/items.ts`
- Test: `src/lib/extensions/items_test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/extensions/items_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { extensionItems } from "./items.ts";
import type { Extension } from "./bindings.ts";

function ext(over: Partial<Extension> = {}): Extension {
  return {
    id: "linter",
    name: "linter",
    origin: "local",
    state: "pending",
    scope: "ws-2",
    ...over,
  };
}

// An extension from an ancestor scope is enabled and revoked in root, never here, so it
// is inherited whatever its own state says. Reading `state` instead would offer a
// workspace an Enable button for a row it cannot act on.
Deno.test("an extension from another scope is inherited whatever its own state", () => {
  const items = extensionItems(
    [ext({ scope: "root", state: "enabled" })],
    "ws-2",
  );
  assertEquals(items[0].state, "inherited");
});

Deno.test("in its own scope, pending awaits review and enabled is active", () => {
  const items = extensionItems([
    ext({ id: "a", name: "a", state: "pending" }),
    ext({ id: "b", name: "b", state: "enabled" }),
  ], "ws-2");
  assertEquals(items.map((i) => i.state), ["pending", "active"]);
});

Deno.test("the origin becomes the row badge", () => {
  const items = extensionItems([ext({ origin: "package" })], "ws-2");
  assertEquals(items[0].badge, "package");
});

// The source string is what a package row is really identified by; a local module has
// none and falls back to its path.
Deno.test("the subtitle prefers the source and falls back to the path", () => {
  assertEquals(
    extensionItems([ext({ source: "npm:@pi/git" })], "ws-2")[0].subtitle,
    "npm:@pi/git",
  );
  assertEquals(
    extensionItems([ext({ path: "/home/x/mod.ts" })], "ws-2")[0].subtitle,
    "/home/x/mod.ts",
  );
});

// The key carries the item's OWN scope, not the viewed one, so root's copy and a
// workspace's copy of the same name never collide in the expanded-row state.
Deno.test("the key is namespaced by kind and by the item's own scope", () => {
  const items = extensionItems([ext({ scope: "root", id: "linter" })], "ws-2");
  assertEquals(items[0].key, "extension/root/linter");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/extensions/items_test.ts` Expected: FAIL —
`Module not found "./items.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/extensions/items.ts`:

```ts
// Maps a scope's visible extensions into Library rows. Pure: the fetch belongs to
// Library.svelte, which does all five of the module's reads in one go so a scope switch
// can discard them together.
import type { Extension } from "./bindings.ts";
import type { LibraryItem, LibraryState } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";

// `visible` is everything reachable from `scope` — its own plus what it inherits.
function stateOf(e: Extension, scope: ScopeId): LibraryState {
  // Enabled and revoked where it lives, so a workspace can only look at root's.
  if (e.scope !== scope) return "inherited";
  return e.state === "pending" ? "pending" : "active";
}

export function extensionItems(
  visible: Extension[],
  scope: ScopeId,
): LibraryItem[] {
  return visible.map((ext) => ({
    kind: "extension" as const,
    key: `extension/${ext.scope}/${ext.id}`,
    scope: ext.scope,
    state: stateOf(ext, scope),
    title: ext.name,
    // What the row is really identified by: a package's source string, or a local
    // module's path.
    subtitle: ext.source ?? ext.path,
    badge: ext.origin,
    ext,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A src/lib/extensions/items_test.ts` Expected: PASS — 5 passed.

- [ ] **Step 5: Format and commit**

```bash
deno fmt src/lib/extensions/ && git add src/lib/extensions/items.ts src/lib/extensions/items_test.ts && git commit -m "Map extensions into Library rows"
```

---

## Task 3: The prompt mapper

**Files:**

- Create: `src/lib/prompts/items.ts`
- Test: `src/lib/prompts/items_test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/prompts/items_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { promptItems } from "./items.ts";
import type { PromptInfo } from "./bindings.ts";

function p(over: Partial<PromptInfo> = {}): PromptInfo {
  return {
    name: "standup",
    description: "",
    body: "hello",
    scope: "ws-2",
    state: "live",
    ...over,
  };
}

Deno.test("a pending template awaits review and a live one is active", () => {
  const items = promptItems(
    [
      p({ name: "a", state: "pending" }),
      p({ name: "b", state: "live" }),
    ],
    [],
    "ws-2",
  );
  assertEquals(items.map((i) => i.state), ["pending", "active"]);
});

// The `/` is how you invoke it, and it is how the `/` menu shows it, so the row says the
// same thing rather than making you remember the prefix.
Deno.test("the title carries the leading slash", () => {
  assertEquals(
    promptItems([p({ name: "standup" })], [], "ws-2")[0].title,
    "/standup",
  );
});

// Root's list arrives whole; only its live templates are invocable in a workspace, so a
// pending one in root must not appear as something this workspace inherits.
Deno.test("only root's live templates are inherited", () => {
  const items = promptItems([], [
    p({ name: "shared", scope: "root", state: "live" }),
    p({ name: "draft", scope: "root", state: "pending" }),
  ], "ws-2");
  assertEquals(items.map((i) => i.title), ["/shared"]);
  assertEquals(items[0].state, "inherited");
});

// pi resolves a name collision by load order (prompts/service.ts) and the local one
// wins, so root's row is listed but unreachable. Saying nothing would show two live
// rows for one working template.
Deno.test("a root template shadowed by a local one of the same name says so", () => {
  const items = promptItems(
    [p({ name: "standup", state: "live" })],
    [p({ name: "standup", scope: "root", state: "live" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, "shadowed");
});

Deno.test("an unshadowed inherited template has no badge", () => {
  const items = promptItems(
    [p({ name: "standup", state: "live" })],
    [p({ name: "other", scope: "root", state: "live" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, undefined);
});

// A local PENDING template does not shadow anything — it cannot be invoked at all yet.
Deno.test("a pending local template does not shadow root's live one", () => {
  const items = promptItems(
    [p({ name: "standup", state: "pending" })],
    [p({ name: "standup", scope: "root", state: "live" })],
    "ws-2",
  );
  const inherited = items.find((i) => i.state === "inherited");
  assertEquals(inherited?.badge, undefined);
});

// A template whose frontmatter would not parse is still listed, with its body, so you
// can see what is wrong instead of the file silently vanishing.
Deno.test("a parse error rides along as a problem", () => {
  const items = promptItems(
    [p({ error: "frontmatter: bad yaml" })],
    [],
    "ws-2",
  );
  assertEquals(items[0].problem, "frontmatter: bad yaml");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/prompts/items_test.ts` Expected: FAIL —
`Module not found "./items.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/prompts/items.ts`:

```ts
// Maps a scope's prompt templates into Library rows, and holds the editor's draft shape.
// Pure: Library.svelte owns the fetch.
import type { PromptInfo } from "./bindings.ts";
import type { LibraryItem } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";

// The create/edit form's state. It lives in the shell rather than in PromptEditor so a
// scope switch can discard it — a draft belongs to the scope it was started in, and
// saving it after a switch would write it into the wrong one.
export type Draft = {
  name: string;
  description: string;
  argumentHint: string;
  body: string;
  // Whether the name is still editable. Renaming an existing template would save under
  // the new name and leave the old file behind.
  creating: boolean;
};

function row(prompt: PromptInfo, state: LibraryItem["state"]): LibraryItem {
  return {
    kind: "prompt",
    key: `prompt/${prompt.scope}/${prompt.name}`,
    scope: prompt.scope,
    state,
    title: `/${prompt.name}`,
    subtitle: prompt.description,
    problem: prompt.error,
    prompt,
  };
}

// `own` is the scope's own templates, both states — the ones it can edit and approve.
// `root` is root's full list, of which only the live ones are invocable here; ROOT
// itself must be passed an empty array, since it inherits from nothing and would
// otherwise list every one of its own templates twice.
export function promptItems(
  own: PromptInfo[],
  root: PromptInfo[],
  _scope: ScopeId,
): LibraryItem[] {
  const liveLocally = new Set(
    own.filter((p) => p.state === "live").map((p) => p.name),
  );

  const items = own.map((p) =>
    row(p, p.state === "pending" ? "pending" : "active")
  );

  for (const p of root) {
    if (p.state !== "live") continue;
    const item = row(p, "inherited");
    // pi takes the nearest on a name collision (prompts/service.ts), so root's copy is
    // listed but unreachable. A pending local template shadows nothing — it cannot be
    // invoked at all yet.
    if (liveLocally.has(p.name)) item.badge = "shadowed";
    items.push(item);
  }
  return items;
}
```

Note the `_scope` parameter: it is unused, because a prompt's own `scope` field
already says where it lives and the caller decides what to pass as `root`. It
stays in the signature so all three mappers are called the same way from the
shell. `deno lint` ignores a leading underscore.

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A src/lib/prompts/items_test.ts` Expected: PASS — 7 passed.

- [ ] **Step 5: Format and commit**

```bash
deno fmt src/lib/prompts/ && git add src/lib/prompts/items.ts src/lib/prompts/items_test.ts && git commit -m "Map prompt templates into Library rows"
```

---

## Task 4: The skill mapper

**Files:**

- Create: `src/lib/skills/items.ts`
- Test: `src/lib/skills/items_test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/skills/items_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { skillItems } from "./items.ts";
import type { SkillInfo } from "./bindings.ts";

function s(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    name: "brainstorming",
    description: "explore an idea",
    path: "/home/x/.pique/scopes/ws-2/agent/skills/brainstorming",
    scope: "ws-2",
    ...over,
  };
}

// A skill has no review gate — it is markdown a model reads, not code that executes — so
// the only question is whose it is.
Deno.test("a skill in this scope is active and one from an ancestor is inherited", () => {
  assertEquals(skillItems([s()], "ws-2")[0].state, "active");
  assertEquals(
    skillItems([s({ scope: "root" })], "ws-2")[0].state,
    "inherited",
  );
});

Deno.test("no skill is ever pending", () => {
  const items = skillItems([s(), s({ name: "other", scope: "root" })], "ws-2");
  assertEquals(items.filter((i) => i.state === "pending"), []);
});

// An automaton names a skill by its path basename, never by the frontmatter `name:`
// (skills/service.ts). Surfacing the divergence here beats a mysterious "skill not
// found" at launch time.
Deno.test("a frontmatter name that disagrees with the basename becomes a note", () => {
  const items = skillItems([
    s({ name: "brainstorm", frontmatterName: "brainstorming" }),
  ], "ws-2");
  assertEquals(
    items[0].note,
    "Its frontmatter says brainstorming; name it brainstorm.",
  );
});

Deno.test("a frontmatter name that agrees leaves no note", () => {
  const items = skillItems([s({ frontmatterName: "brainstorming" })], "ws-2");
  assertEquals(items[0].note, undefined);
});

// Malformed frontmatter is a problem (red), a naming quirk is a note (dim). A file that
// will not parse has no usable frontmatterName to disagree about anyway.
Deno.test("malformed frontmatter is a problem, not a note", () => {
  const items = skillItems([s({ error: "frontmatter: bad yaml" })], "ws-2");
  assertEquals(items[0].problem, "frontmatter: bad yaml");
  assertEquals(items[0].note, undefined);
});

// listVisibleSkills de-duplicates by name across the chain, but two scopes can still
// hold different skills, so the path is what makes a key unique.
Deno.test("the key is namespaced by the skill's path", () => {
  const items = skillItems([s({ path: "/a/b/c", scope: "root" })], "ws-2");
  assertEquals(items[0].key, "skill/root//a/b/c");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/skills/items_test.ts` Expected: FAIL —
`Module not found "./items.ts"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/skills/items.ts`:

```ts
// Maps a scope's visible skills into Library rows. Pure: Library.svelte owns the fetch.
import type { SkillInfo } from "./bindings.ts";
import type { LibraryItem } from "../library/items.ts";
import type { ScopeId } from "../scope/paths.ts";

// `visible` is every skill nameable in `scope` — its own plus each ancestor's, already
// de-duplicated by nearest-wins in skills/service.ts, so a name appears exactly once.
// A skill is never pending: it is markdown a model reads, not code that executes, so
// there is nothing to review and nothing to enable.
export function skillItems(
  visible: SkillInfo[],
  scope: ScopeId,
): LibraryItem[] {
  return visible.map((skill) => ({
    kind: "skill" as const,
    key: `skill/${skill.scope}/${skill.path}`,
    scope: skill.scope,
    state: skill.scope === scope ? "active" : "inherited",
    title: skill.name,
    subtitle: skill.description,
    // Frontmatter that would not parse: the skill still loads, but its description is
    // missing and that is worth saying rather than showing a blank line.
    problem: skill.error,
    // An automaton names a skill by its path basename, never by the frontmatter `name:`.
    // A divergence is not an error — the skill works — but it will make a `skills:`
    // entry that copies the frontmatter fail to resolve.
    note: skill.frontmatterName && skill.frontmatterName !== skill.name
      ? `Its frontmatter says ${skill.frontmatterName}; name it ${skill.name}.`
      : undefined,
    skill,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test -A src/lib/skills/items_test.ts` Expected: PASS — 6 passed.

- [ ] **Step 5: Run the whole suite and commit**

```bash
deno task test
```

Expected: PASS. The three sub-tab components still exist and still work —
nothing has been wired up yet.

```bash
deno fmt src/lib/skills/ && git add src/lib/skills/items.ts src/lib/skills/items_test.ts && git commit -m "Map skills into Library rows"
```

---

## Task 5: Extract the four detail components

These are lifted from the existing sections with no behaviour change. They are
unused until Task 6, which keeps this commit additive and the build green
throughout.

**Files:**

- Create: `src/lib/extensions/ExtensionReview.svelte`
- Create: `src/lib/prompts/PromptDetail.svelte`
- Create: `src/lib/prompts/PromptEditor.svelte`
- Create: `src/lib/skills/SkillDetail.svelte`

- [ ] **Step 1: Create `src/lib/extensions/ExtensionReview.svelte`**

This is `Extensions.svelte`'s `reviewPane` snippet (lines 163–193), verbatim, as
a component.

```svelte
<script lang="ts">
  import type { ExtensionSource } from "./bindings.ts";

  // Presentation only. Library.svelte does the extensionsRead and keeps the digest it
  // returned, so the bytes handed to extensionsEnable are provably the bytes shown here
  // — splitting the read across this boundary would make the gate prove nothing.
  //
  // One pane for both origins: a local module is always a single file, a package is
  // however many entry files pi resolved for it, and it is the code that is the artifact
  // either way.
  let { source }: { source: ExtensionSource } = $props();
</script>

{#each source.files as f (f.path)}
  <div class="mt-2 truncate font-mono text-[0.65rem] opacity-60" title={f.path}>{f.path}</div>
  <pre class="mt-1 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
    >{f.text}</code></pre>
{/each}

{#if source.files.length === 0}
  <div class="mt-2 text-xs opacity-60">
    No extension entry files — this package ships skills or prompts only.
  </div>
{/if}

{#if source.skills.length > 0}
  <div class="mt-2 text-xs opacity-70">
    Also ships {source.skills.length}
    skill{source.skills.length === 1 ? "" : "s"} — not code, but their text reaches
    the agent:
  </div>
  <ul class="mt-1 max-h-24 overflow-y-auto text-[0.65rem] opacity-60">
    {#each source.skills as sk (sk)}
      <li class="truncate font-mono" title={sk}>{sk}</li>
    {/each}
  </ul>
{/if}

{#if source.truncated}
  <div class="mt-1 text-[0.65rem] text-warning">
    Long file truncated for display — read it on disk before enabling.
  </div>
{/if}
```

- [ ] **Step 2: Create `src/lib/prompts/PromptDetail.svelte`**

The read-only half of `Prompts.svelte`'s expanded row (its rationale block and
body `<pre>`).

```svelte
<script lang="ts">
  import type { PromptInfo } from "./bindings.ts";

  // The read-only view of a template. The editor is a separate component: it opens
  // beneath the Add bar rather than inside a row, because a create and an edit are the
  // same form and a form nested in a list row is the more awkward of the two.
  let { prompt }: { prompt: PromptInfo } = $props();
</script>

{#if prompt.rationale}
  <!-- Recorded by define_prompt. Shown to the reviewer, never part of the expanded
       prompt, which is why it is not in the body. -->
  <div class="mt-1.5 text-[0.65rem] opacity-70">Agent's rationale: {prompt.rationale}</div>
{/if}
<pre class="mt-1.5 max-h-56 overflow-auto rounded bg-base-300 p-2 text-[0.65rem] leading-relaxed"><code
  >{prompt.body}</code></pre>
```

- [ ] **Step 3: Create `src/lib/prompts/PromptEditor.svelte`**

`Prompts.svelte`'s draft form (lines 213–249), with the draft bound in from the
shell.

```svelte
<script lang="ts">
  import type { Draft } from "./items.ts";

  // One form for creating and editing: an existing template keeps its name, because
  // saving under a new one would leave the old file behind.
  //
  // `draft` is bindable rather than owned here so the shell can discard it on a scope
  // switch — a draft belongs to the scope it was started in.
  let {
    draft = $bindable(),
    busy,
    onsave,
    oncancel,
  }: {
    draft: Draft;
    busy: boolean;
    onsave: () => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="mb-2 rounded border border-primary/50 p-3">
  <div class="flex items-center gap-2">
    <span class="font-mono text-xs">/</span>
    <input
      class="input input-bordered input-xs flex-1 font-mono"
      placeholder="name"
      aria-label="Template name"
      disabled={!draft.creating}
      bind:value={draft.name}
    />
    <input
      class="input input-bordered input-xs flex-1 font-mono"
      placeholder="argument hint, e.g. <file-path>"
      aria-label="Argument hint"
      bind:value={draft.argumentHint}
    />
  </div>
  <input
    class="input input-bordered input-xs mt-2 w-full"
    placeholder="description — shown beside the name in the / menu"
    aria-label="Description"
    bind:value={draft.description}
  />
  <textarea
    class="textarea textarea-bordered mt-2 h-32 w-full font-mono text-xs leading-relaxed"
    placeholder={"The message to send. $1 for the first argument, $@ for all of them."}
    aria-label="Template body"
    bind:value={draft.body}
  ></textarea>
  <div class="mt-2 flex justify-end gap-1">
    <button type="button" class="btn btn-ghost btn-xs" onclick={oncancel}>Cancel</button>
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={busy || draft.name.trim() === "" || draft.body.trim() === ""}
      onclick={onsave}
    >Save</button>
  </div>
</div>
```

- [ ] **Step 4: Create `src/lib/skills/SkillDetail.svelte`**

```svelte
<script lang="ts">
  import type { SkillInfo } from "./bindings.ts";

  // A skill's expanded row. There is nothing to enable, revoke or quarantine — only to
  // see and to name — so this shows the one thing the collapsed row cannot: where the
  // file actually is, which is what you need in order to edit it.
  let { skill }: { skill: SkillInfo } = $props();
</script>

<div class="mt-2 truncate font-mono text-[0.65rem] opacity-60" title={skill.path}>{skill.path}</div>
{#if skill.description}
  <div class="mt-1 text-xs opacity-80">{skill.description}</div>
{/if}
```

- [ ] **Step 5: Verify the build still succeeds**

Run: `deno task build` Expected: vite builds with no errors. The four new
components are not imported yet, so this only proves they parse.

- [ ] **Step 6: Format and commit**

```bash
deno fmt src/lib/ && git add src/lib/extensions/ExtensionReview.svelte src/lib/prompts/PromptDetail.svelte src/lib/prompts/PromptEditor.svelte src/lib/skills/SkillDetail.svelte && git commit -m "Extract the Library detail views into their feature directories"
```

---

## Task 6: Rewrite the shell and delete the sub-tabs

The big one. `Library.svelte` gains the fetch, the groups, the rows, the actions
and the Add bar; the three section components go.

**Files:**

- Modify: `src/lib/library/Library.svelte` (full rewrite)
- Delete: `src/lib/extensions/Extensions.svelte`
- Delete: `src/lib/prompts/Prompts.svelte`
- Delete: `src/lib/skills/Skills.svelte`

- [ ] **Step 1: Replace the contents of `src/lib/library/Library.svelte`**

```svelte
<script lang="ts">
  import { ROOT } from "../scope/paths.ts";
  import {
    extensionBindings,
    type ExtensionSource,
    type ExtSearchResult,
  } from "../extensions/bindings.ts";
  import { promptBindings } from "../prompts/bindings.ts";
  import { skillBindings } from "../skills/bindings.ts";
  import { extensionItems } from "../extensions/items.ts";
  import { type Draft, promptItems } from "../prompts/items.ts";
  import { skillItems } from "../skills/items.ts";
  import { groupItems, type LibraryItem, type LibraryKind } from "./items.ts";
  import { refreshChatCommands } from "../chat/store.ts";
  import ExtensionReview from "../extensions/ExtensionReview.svelte";
  import PromptDetail from "../prompts/PromptDetail.svelte";
  import PromptEditor from "../prompts/PromptEditor.svelte";
  import SkillDetail from "../skills/SkillDetail.svelte";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  // Which scope this module acts on: its own workspace's, or the shared root one it
  // inherits from. Root itself has nothing else to switch to, so the toggle is hidden
  // there — same shape as Kanban's board switcher.
  //
  // `workspaceId` is optional only because Column threads it through as optional; every
  // real workspace has an id, and root's IS `ROOT` (session.ts).
  const workspace = $derived(workspaceId ?? ROOT);
  const isRootWorkspace = $derived(workspace === ROOT);
  let showRoot = $state(false);
  const scope = $derived(showRoot ? ROOT : workspace);
  // NOT the same as isRootWorkspace: a workspace viewing root's list is editing root.
  // This is what decides whether enabling here reaches every workspace.
  const scopeIsRoot = $derived(scope === ROOT);

  // A module tab stays mounted when it is not active (Column.svelte hides it with a
  // class), so nothing re-lists on its own — bumping this counter is how the user asks.
  let refreshKey = $state(0);

  const ext = extensionBindings();
  const prompts = promptBindings();
  const skills = skillBindings();
  // All three factories read the same `globalThis.bindings`, so one check covers the
  // lot: in web mode there is no desktop backend at all.
  const desktop = ext !== null && prompts !== null && skills !== null;

  let items = $state<LibraryItem[]>([]);
  let loadErrors = $state<Array<{ name: string; error: string }>>([]);
  const groups = $derived(groupItems(items));

  let busy = $state(false);
  let notice = $state("");
  let error = $state("");

  // The expanded row, by LibraryItem.key, and the extension source read for it.
  let openKey = $state<string | null>(null);
  let reviewed = $state<ExtensionSource | null>(null);

  // Browse the pi catalog, and add a source by hand. Both land in the same confirm gate:
  // downloading an npm package runs its install scripts, which happens before any review
  // is possible (docs/extensions.md).
  let query = $state("");
  let results = $state<ExtSearchResult[]>([]);
  let searching = $state(false);
  let source = $state("");
  let sourceOpen = $state(false);
  let confirming = $state(false);

  let draft = $state<Draft | null>(null);

  const KIND_LABEL: Record<LibraryKind, string> = {
    extension: "ext",
    prompt: "prompt",
    skill: "skill",
  };

  // One read for the whole module. Every call is fired together and discarded together:
  // a scope switch that lands mid-flight must not paint one scope's extensions beside
  // another's templates.
  async function refresh(): Promise<void> {
    if (!ext || !prompts || !skills) return;
    const forScope = scope;
    // Captured, not re-read after the await: reading the prop again would mix one
    // scope's list with the other's answer to "does this scope inherit".
    const forIsRoot = scopeIsRoot;
    try {
      const [visibleExts, failures, ownPrompts, rootPrompts, visibleSkills] = await Promise
        .all([
          ext.extensionsVisible({ scope: forScope }),
          ext.extensionsLoadErrors({ scope: forScope }).catch(() => []),
          prompts.promptsList({ scope: forScope }),
          // Root inherits from nothing; passing its own list here would list every one
          // of its templates twice.
          forIsRoot ? Promise.resolve([]) : prompts.promptsList({ scope: ROOT }),
          skills.skillsVisible({ scope: forScope }),
        ]);
      if (forScope !== scope) return;
      items = [
        ...extensionItems(visibleExts, forScope),
        ...promptItems(ownPrompts, rootPrompts, forScope),
        ...skillItems(visibleSkills, forScope),
      ];
      loadErrors = failures;
    } catch (e) {
      if (forScope !== scope) return;
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Every mutation has the same shape: run, collapse the open row, re-list, report.
  // `touchesPrompts` adds one step — a template change alters what `/` offers, so live
  // conversations re-read their menus.
  async function act(
    run: () => Promise<unknown>,
    message: string,
    touchesPrompts = false,
  ): Promise<void> {
    const forScope = scope;
    busy = true;
    error = "";
    notice = "";
    try {
      await run();
      openKey = null;
      draft = null;
      await refresh();
      if (touchesPrompts) refreshChatCommands();
      // A scope switch during the mutation would otherwise report "Enabled X" over a
      // list that no longer contains X.
      if (forScope === scope) notice = message;
    } catch (e) {
      if (forScope === scope) error = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }

  async function toggle(item: LibraryItem): Promise<void> {
    if (openKey === item.key) {
      openKey = null;
      return;
    }
    error = "";
    if (item.kind === "extension") {
      if (!ext) return;
      try {
        // Read here rather than in ExtensionReview: the digest handed to
        // extensionsEnable must be the one THIS read produced, or the gate proves
        // nothing about the bytes that were on screen.
        reviewed = await ext.extensionsRead({
          scope: item.scope,
          id: item.ext.id,
          state: item.ext.state,
        });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        return;
      }
    }
    openKey = item.key;
  }

  // One verb over two backends. Enabling an extension lets code run; approving a
  // template lets text be sent — the same act of letting something out of quarantine,
  // which is why the button says the same word and the badge carries the difference.
  // Each of these destructures its payload BEFORE building the closure. TypeScript
  // narrows a `const` inside a closure but not a parameter, so reaching for `item.ext`
  // from inside the callback would lose the narrowing that the `item.kind` check just
  // established.
  function enable(item: LibraryItem): void {
    if (item.kind === "extension" && ext) {
      const { id, name } = item.ext;
      // What was actually read. The backend refuses the enable if the bytes changed
      // since, however long this tab has been open.
      const expectDigest = reviewed?.digest;
      act(
        () => ext.extensionsEnable({ scope, id, expectDigest }),
        `Enabled ${name}. Type /reload in a Chat module to load it there.`,
      );
    } else if (item.kind === "prompt" && prompts) {
      const { name } = item.prompt;
      act(
        () => prompts.promptsApprove({ scope, name }),
        `Enabled ${item.title}. Type ${item.title} in a chat to use it.`,
        true,
      );
    }
  }

  function revoke(item: LibraryItem): void {
    if (item.kind !== "extension" || !ext) return;
    const { id, name } = item.ext;
    act(
      () => ext.extensionsRevoke({ scope, id }),
      `Revoked ${name}. It is back in Awaiting review; /reload a Chat module to apply.`,
    );
  }

  function remove(item: LibraryItem): void {
    if (item.kind === "extension" && ext) {
      const { id, name, state } = item.ext;
      act(
        () => ext.extensionsRemove({ scope, id, state }),
        `Deleted ${name}.${item.state === "active" ? " /reload a Chat module to apply." : ""}`,
      );
    } else if (item.kind === "prompt" && prompts) {
      const { name } = item.prompt;
      const pending = item.state === "pending";
      // One label over two bindings: reject takes a pending template out of quarantine,
      // delete removes a live one. Both remove the file; only the directories differ.
      act(
        () =>
          pending
            ? prompts.promptsReject({ scope, name })
            : prompts.promptsDelete({ scope, name, state: "live" }),
        `Deleted ${item.title}.`,
        true,
      );
    }
  }

  function edit(item: LibraryItem): void {
    if (item.kind !== "prompt") return;
    draft = {
      name: item.prompt.name,
      description: item.prompt.description,
      argumentHint: item.prompt.argumentHint ?? "",
      body: item.prompt.body,
      creating: false,
    };
  }

  function newPrompt(): void {
    draft = { name: "", description: "", argumentHint: "", body: "", creating: true };
  }

  function saveDraft(): void {
    const d = draft;
    if (!prompts || !d) return;
    act(
      () =>
        prompts.promptsSave({
          scope,
          name: d.name.trim(),
          description: d.description.trim(),
          // Absent and empty mean the same thing for a hint, so "" is not written.
          argumentHint: d.argumentHint.trim() || undefined,
          body: d.body,
        }),
      `Saved /${d.name.trim()}. Type /${d.name.trim()} in a chat to use it.`,
      true,
    );
  }

  async function search(): Promise<void> {
    if (!ext) return;
    searching = true;
    error = "";
    try {
      results = await ext.extensionsSearch({ query: query.trim() });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    searching = false;
  }

  // Fetch the bytes into quarantine. This does NOT enable anything — it lands in
  // Awaiting review alongside agent-written modules, and you read its code first.
  async function confirmFetch(): Promise<void> {
    confirming = false;
    if (!ext) return;
    const wanted = source.trim();
    await act(
      () => ext.extensionsFetch({ scope, source: wanted }),
      "Downloaded. Review it under Awaiting review, then Enable it.",
    );
    if (!error) {
      source = "";
      sourceOpen = false;
    }
  }

  // Re-list when the scope changes or Refresh is pressed — both change what this shows.
  // Clears stale notices and collapses any open row.
  $effect(() => {
    void refreshKey;
    if (desktop && scope) {
      error = "";
      notice = "";
      confirming = false;
      openKey = null;
      refresh();
    }
  });

  // A draft belongs to the scope it was started in — saving it after a switch would
  // write it into the wrong one. Refresh must NOT discard it: that button sits directly
  // above the editor, and a draft is unsaved user input.
  $effect(() => {
    void scope;
    draft = null;
  });
</script>

<!-- One row for every kind. What differs between kinds is which buttons it carries and
     what expanding it shows; everything else — badge, title, subtitle — is common, which
     is the whole reason these three lists became one. -->
{#snippet row(item: LibraryItem)}
  <li class="px-3 py-2">
    <div class="flex items-center justify-between gap-2">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="badge badge-ghost badge-xs shrink-0">{KIND_LABEL[item.kind]}</span>
        {#if item.badge}
          <span class="badge badge-ghost badge-xs shrink-0 opacity-70">{item.badge}</span>
        {/if}
        <span
          class="truncate font-mono text-xs"
          class:opacity-70={item.state === "inherited"}
          title={item.subtitle ?? item.title}
        >{item.title}</span>
        {#if item.subtitle}
          <span class="truncate text-[0.65rem] opacity-60">{item.subtitle}</span>
        {/if}
      </span>
      <div class="flex shrink-0 gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => toggle(item)}
        >{openKey === item.key
            ? "Hide"
            : item.state === "pending"
            ? "Review"
            : "View"}</button>
        {#if item.state === "pending"}
          <!-- Disabled until the row is expanded. Approving without looking is the
               failure the whole gate exists to prevent, and that is as true of text
               that becomes your message as of code that executes. -->
          <button
            type="button"
            class="btn btn-warning btn-xs"
            disabled={busy || openKey !== item.key}
            title={openKey === item.key ? "" : "Read it first"}
            onclick={() => enable(item)}
          >Enable</button>
        {:else if item.state === "active" && item.kind === "extension"}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={busy}
            onclick={() => revoke(item)}
          >Revoke</button>
        {:else if item.state === "active" && item.kind === "prompt"}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={busy}
            onclick={() => edit(item)}
          >Edit</button>
        {/if}
        {#if item.state !== "inherited" && item.kind !== "skill"}
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={busy}
            onclick={() => remove(item)}
          >Delete</button>
        {/if}
      </div>
    </div>

    {#if openKey === item.key}
      {#if item.state === "pending"}
        <div class="mt-2 text-xs opacity-80">
          {#if item.kind === "extension"}
            This code runs with full system access once enabled. Read it before enabling.
          {:else}
            This text is sent as your message when you invoke it.
          {/if}
          {#if scopeIsRoot}Enabling here reaches every workspace.{/if}
        </div>
      {/if}
      {#if item.kind === "extension"}
        {#if reviewed}<ExtensionReview source={reviewed} />{/if}
      {:else if item.kind === "prompt"}
        <PromptDetail prompt={item.prompt} />
      {:else}
        <SkillDetail skill={item.skill} />
      {/if}
    {/if}

    {#if item.problem}
      <div class="mt-1.5 break-all text-[0.65rem] text-error">{item.problem}</div>
    {/if}
    {#if item.note}
      <div class="mt-1 text-[0.65rem] opacity-50">{item.note}</div>
    {/if}
  </li>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-3 py-1.5">
    <span class="text-xs font-semibold">Library</span>

    {#if !isRootWorkspace}
      <div class="ml-3 flex items-center gap-1" role="group" aria-label="Scope">
        <span class="mr-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">Scope</span>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={!showRoot}
          aria-pressed={!showRoot}
          onclick={() => (showRoot = false)}
        >Workspace</button>
        <button
          class="btn btn-ghost btn-xs"
          class:btn-active={showRoot}
          aria-pressed={showRoot}
          onclick={() => (showRoot = true)}
        >Root</button>
        <span class="ml-2 text-xs opacity-60">
          {showRoot
            ? "Shared with every workspace."
            : "This workspace only; adds to what it inherits from root."}
        </span>
      </div>
    {/if}

    <button
      class="btn btn-ghost btn-xs ml-auto"
      aria-label="Refresh"
      title="Re-read this scope's extensions, templates and skills"
      onclick={() => refreshKey++}
    >↻</button>
  </div>

  {#if !desktop}
    <div class="p-4 text-xs opacity-70">Available in the desktop app only.</div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <!-- The Add bar. The catalog searches pi PACKAGES, which is the install path for
           extensions, templates and skills alike — which is why it sits above the whole
           library rather than under one part of it. -->
      <div class="flex gap-2">
        <input
          class="input input-bordered input-sm flex-1"
          placeholder="Search the pi catalog…"
          aria-label="Search the pi catalog"
          bind:value={query}
          disabled={busy || searching}
          onkeydown={(e) => e.key === "Enter" && search()}
        />
        <button type="button" class="btn btn-sm" disabled={busy || searching} onclick={search}>
          {searching ? "Searching…" : "Search"}
        </button>
        <button type="button" class="btn btn-sm" disabled={busy} onclick={newPrompt}>
          New prompt
        </button>
        <button
          type="button"
          class="btn btn-sm"
          disabled={busy}
          onclick={() => (sourceOpen = !sourceOpen)}
        >Add source…</button>
      </div>

      {#if draft}
        <div class="mt-3">
          <PromptEditor
            bind:draft
            {busy}
            onsave={saveDraft}
            oncancel={() => (draft = null)}
          />
        </div>
      {/if}

      {#if confirming}
        <div class="mt-3 rounded border border-warning/50 bg-warning/10 p-3">
          <div class="text-sm font-medium text-warning">Download this package?</div>
          <div class="mt-1 break-all font-mono text-xs">{source.trim()}</div>
          <div class="mt-1.5 text-xs opacity-80">
            It will be fetched into quarantine for review, not enabled. Downloading an
            npm package runs its install scripts, so only fetch sources you trust.
          </div>
          <div class="mt-2 flex gap-2">
            <button type="button" class="btn btn-warning btn-sm" onclick={confirmFetch}>Download</button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={() => (confirming = false)}
            >Cancel</button>
          </div>
        </div>
      {:else if sourceOpen}
        <div class="mt-3 flex gap-2">
          <input
            class="input input-bordered input-sm flex-1 font-mono"
            placeholder="npm:@scope/pkg  ·  git:github.com/user/repo"
            aria-label="Extension source"
            bind:value={source}
            disabled={busy}
          />
          <button
            type="button"
            class="btn btn-sm"
            disabled={busy || source.trim() === ""}
            onclick={() => (confirming = true)}
          >Add</button>
        </div>
      {/if}

      {#if results.length > 0}
        <ul class="mt-3 max-h-56 divide-y divide-base-300 overflow-y-auto rounded border border-base-300">
          {#each results as r (r.source)}
            <li class="flex items-start justify-between gap-2 px-3 py-2">
              <div class="min-w-0">
                <div class="truncate font-mono text-xs" title={r.source}>{r.name}</div>
                {#if r.description}
                  <div class="mt-0.5 line-clamp-2 text-xs opacity-70">{r.description}</div>
                {/if}
                <div class="mt-0.5 text-[0.65rem] opacity-50">
                  {#if r.author}{r.author} · {/if}{r.downloads.toLocaleString()}/mo
                </div>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs shrink-0"
                disabled={busy}
                onclick={() => {
                  source = r.source;
                  confirming = true;
                }}
              >Add</button>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Enabled but unloadable. Kept out of the rows on purpose: a failure names a
           file inside an install tree, not the source string a row shows, so matching
           them up would silently miss. -->
      {#if loadErrors.length > 0}
        <div class="mt-4 rounded border border-error/50 p-2">
          <div class="text-xs text-error">
            Enabled, but {loadErrors.length === 1 ? "one extension" : "these extensions"}
            failed to load — the agent does not get {loadErrors.length === 1
              ? "its"
              : "their"} tools:
          </div>
          <ul class="mt-1 space-y-1">
            {#each loadErrors as f (f.name)}
              <li class="text-[0.65rem]">
                <span class="font-mono opacity-80">{f.name}</span>
                <span class="opacity-60"> — {f.error.split("\n")[0]}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="mt-4 mb-2 text-xs opacity-70">Awaiting review:</div>
      {#if groups.pending.length > 0}
        <ul class="divide-y divide-base-300 rounded border border-warning/50">
          {#each groups.pending as item (item.key)}{@render row(item)}{/each}
        </ul>
      {:else}
        <div class="text-xs opacity-60">Nothing awaiting review.</div>
      {/if}

      <div class="mt-4 mb-2 text-xs opacity-70">Active:</div>
      {#if groups.active.length > 0}
        <ul class="divide-y divide-base-300 rounded border border-base-300">
          {#each groups.active as item (item.key)}{@render row(item)}{/each}
        </ul>
      {:else}
        <div class="text-xs opacity-60">Nothing yet.</div>
      {/if}

      {#if groups.inherited.length > 0}
        <div class="mt-4 mb-2 text-xs opacity-70">
          Inherited from Root <span class="opacity-60">— managed there, not here</span>:
        </div>
        <ul class="divide-y divide-base-300 rounded border border-dashed border-base-300">
          {#each groups.inherited as item (item.key)}{@render row(item)}{/each}
        </ul>
      {/if}

      <div class="mt-4 text-[0.65rem] opacity-50">
        Extensions add tools to Chat and load into sessions started afterwards, or on
        <code>/reload</code>. A template is sent by typing <code>/name</code>. Skills are
        read-only here — add one by putting a <code>&lt;name&gt;/SKILL.md</code> directory
        or a <code>&lt;name&gt;.md</code> file in this scope's <code>agent/skills/</code>.
      </div>

      {#if notice}<div class="mt-2 text-xs text-success">{notice}</div>{/if}
      {#if error}<div class="mt-2 break-all text-xs text-error">{error}</div>{/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Delete the three sub-tab components**

```bash
git rm src/lib/extensions/Extensions.svelte src/lib/prompts/Prompts.svelte src/lib/skills/Skills.svelte
```

- [ ] **Step 3: Verify nothing still imports them**

Run: `grep -rn "Extensions.svelte\|Prompts.svelte\|Skills.svelte" src/`
Expected: no output. If anything matches, it is a stale import — fix it before
building.

- [ ] **Step 4: Verify the build succeeds**

Run: `deno task build` Expected: vite builds with no errors. A dangling import
or a type mismatch between a mapper and the shell shows up here.

- [ ] **Step 5: Run the whole suite**

```bash
deno task test
```

Expected: PASS. No test touches the deleted components; every
`extensions/*_test.ts`, `prompts/*_test.ts` and `skills/*_test.ts` is unchanged
and must still be green. A failure here means something below the view moved,
which this task must not do.

- [ ] **Step 6: Format and commit**

```bash
deno fmt src/lib/ && git add -A src/lib/ && git commit -m "Unify the Library into one state-grouped list"
```

---

## Task 7: Retarget the copy that names a sub-tab

`Library → Extensions`, `Library → Prompts` and `Library → Skills` are now dead
addresses. Each becomes **the Library module**.

**Files:**

- Modify: `src/lib/extensions/agent-tools.ts:3,43,70`
- Modify: `src/lib/prompts/agent-tools.ts:4,35,79`
- Modify: `src/lib/automatons/resolve.ts:147,159,184`
- Modify: `src/desktop.ts:148`
- Modify: `src/lib/chat/agent.ts:438`
- Modify: `src/lib/chat/store.ts:247,297`
- Modify: `src/lib/prompts/parse.ts:6,34`
- Modify: `src/lib/prompts/service.ts:58`
- Modify: `src/lib/extensions/service.ts:2` (already says "Library module" —
  verify only)
- Modify: `src/lib/extensions/packages.ts:284`
- Modify: `src/lib/prompts/parse_test.ts:22`
- Modify: `src/lib/chat/prompt_integration_test.ts:71,73`
- Modify: `src/lib/automatons/resolve_test.ts:143,210`

- [ ] **Step 1: List every site**

Run: `grep -rn "Library → " src/` Expected: about 20 matches across the files
above. Work through them.

- [ ] **Step 2: Rewrite the agent-facing strings**

These are repeated back to users by the agent, so they go stale the moment the
sub-tabs do. They are concatenated at runtime — **re-read each one end to end
after editing**, because the join points move.

In `src/lib/extensions/agent-tools.ts`:

```ts
// line 3, comment
// execute until a human reviews and enables it in the Library module, which moves it

// line 43, inside the tool description
"user reviews and enables it in the Library module, and then only in chat sessions " +

// line 70, inside the success message
`must enable it in the Library module, and it loads in chat sessions started ` +
```

In `src/lib/prompts/agent-tools.ts`:

```ts
// line 4, comment
// until a human approves it in the Library module, which moves it into the live dir.

// line 35, inside the tool description
"the Library module. Say so when reporting back. A template is text that gets sent as " +

// line 79, inside the success message
`invocable yet — the user must approve it in the Library module.`,
```

- [ ] **Step 3: Rewrite the user-facing automaton errors**

`src/lib/automatons/resolve.ts` raises these when an automaton names an
extension that is not enabled — a user reads them at launch time.

```ts
// line 147
} (enable it in the Library module)`,

// line 184
} (enable it in the Library module)`,

// line 159, comment
// user at the Library module for something that could never appear there.
```

- [ ] **Step 4: Rewrite the comments**

Plain `Library → X` → `the Library module` in `src/desktop.ts:148`,
`src/lib/chat/agent.ts:438`, `src/lib/chat/store.ts:247,297`,
`src/lib/prompts/parse.ts:6,34`, `src/lib/prompts/service.ts:58`,
`src/lib/extensions/packages.ts:284`, `src/lib/prompts/parse_test.ts:22`,
`src/lib/chat/prompt_integration_test.ts:71,73`,
`src/lib/automatons/resolve_test.ts:143,210`.

Two of these need more than a substitution, because they described a tab:

```ts
// src/lib/prompts/service.ts:58 — "shows them together" was about one sub-tab's two
// sections; the Library now shows them in different groups.
// One scope's own templates, both states in one call — the Library module lists both.

// src/lib/automatons/resolve_test.ts:210 — "a tab where a bare hyphenated name could
// never appear" still holds, but the Library is the tab now.
// the Library module — a list where a bare hyphenated name could never appear.
```

- [ ] **Step 5: Verify nothing names a sub-tab**

Run: `grep -rn "Library → " src/` Expected: no output.

Run: `grep -rn "Settings → Extensions\|Settings → Prompts" src/` Expected: no
output — these went with the original move and must not have come back.

- [ ] **Step 6: Check what must NOT have changed**

Run: `grep -rn "SettingsManager\|Settings → Providers" src/` Expected: matches
in `src/lib/chat/providers.ts` and the pi settings plumbing, untouched.
Providers stayed in Settings and always was about Settings.

- [ ] **Step 7: Run the suite and commit**

```bash
deno task test && deno fmt src/ && git add -A src/ && git commit -m "Point copy at the Library module rather than a sub-tab"
```

Expected: PASS. `agent-tools_test.ts` asserts tool shapes, not these strings, so
it should be unaffected — if it fails, a string edit broke a concatenation.

---

## Task 8: Update the docs

**Files:**

- Modify: `docs/extensions.md:17,305`
- Modify: `docs/prompts.md:68,76,145,163`
- Modify: `docs/scopes.md:208`
- Modify: `docs/automatons.md:316,326,330`
- Modify: `docs/agent-verification.md:38`

- [ ] **Step 1: Substitute in the four reference docs**

`Library → Extensions` / `Library → Prompts` / `Library → Skills` → **the
Library module**, in `docs/extensions.md`, `docs/prompts.md`, `docs/scopes.md`
and `docs/automatons.md`.

**Do not** touch `docs/extensions.md`'s many other "Settings" mentions — those
are pi's own `SettingsManager` (`addSourceToSettings`, `setPackages`) and mean
something else entirely.

Two lines say more than the address and need rewording:

```markdown
<!-- docs/prompts.md:76 — "is a full editor" was about the sub-tab -->

read. The Library module is a full editor — create, edit, delete — not just a

<!-- docs/prompts.md:145 — the marker moved from a section label to a row badge -->

whenever two templates share a name. The Library module badges a shadowed root
```

- [ ] **Step 2: Update the verification checklist**

`docs/agent-verification.md:38-41` currently names the sub-tab strip as the
thing worth testing in web mode. Replace that bullet:

```markdown
- The Library module's chrome — its rail row, the Extensions/Prompts sub-tabs,
  and the scope toggle (which is hidden in the Root workspace, so create a
  second workspace to see it). The lists themselves need the desktop app.
```

with:

```markdown
- The Library module's chrome — its rail row and the scope toggle (which is
  hidden in the Root workspace, so create a second workspace to see it). The
  list itself needs the desktop app.
```

- [ ] **Step 3: Verify**

Run: `grep -rn "Library → " docs/ --include=*.md | grep -v superpowers/`
Expected: no output. The two files under `docs/superpowers/` are the historical
spec and plan for the original move — they are a record of what was decided then
and must not be edited.

- [ ] **Step 4: Format and commit**

```bash
deno fmt docs/ && git add -A docs/ && git commit -m "Update docs for the unified Library"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the whole suite**

```bash
deno task test
```

Expected: PASS, including the 23 new assertions from Tasks 1–4.

- [ ] **Step 2: Check formatting is clean**

```bash
deno fmt --check
```

Expected: no diff.

- [ ] **Step 3: Check the lint count did not grow**

```bash
deno lint 2>&1 | tail -3
```

Expected: about 30 problems — the pre-existing count. It must not be higher. If
it is, the new code introduced one; fix it.

- [ ] **Step 4: Verify the web build**

```bash
deno task build
```

Expected: builds clean.

- [ ] **Step 5: Manual check, web mode**

Start the dev server via the preview tooling (`preview_start {name: "web"}`) —
never `deno task web` in a shell.

Expected: the Library tab opens with no sub-tab strip, and shows "Available in
the desktop app only."

- [ ] **Step 6: Manual check, desktop**

```bash
deno task dev
```

This is the only surface where the lists have data. Work through each:

1. A pending extension and a pending template appear together under **Awaiting
   review**, badged `ext` and `prompt`. Enable is disabled on both until the row
   is expanded.
2. Expanding the extension shows its code; Enable moves it to **Active**;
   `/reload` in a Chat module picks it up.
3. Expanding the template shows its body and the agent's rationale; Enable moves
   it to **Active** and `/name` works in an already-open chat with no restart.
4. **New prompt** opens the editor beneath the Add bar; Save round-trips;
   **Edit** on an active row opens the same editor with the name locked;
   **Delete** removes it.
5. Skills appear in **Active** with only a View button; root's appear under
   **Inherited from Root**.
6. The scope toggle switches every group at once. Switching rapidly does not
   leave the previous scope's rows on screen.
7. **Add source…** reveals the source input; adding shows the install-scripts
   warning; confirming lands the package under **Awaiting review**, never in
   Active.
8. Catalog search returns results; a result's Add goes through the same warning.
9. Refresh picks up a template an agent wrote while the tab stayed open.
10. Open two Library tabs in two different workspaces; expanding a row in one
    does not expand the same-named row in the other.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A && git commit -m "Fix issues found in Library unification verification"
```

Skip if nothing needed fixing.

---

## Notes for the implementer

- **Do not touch any `service.ts`, `bindings.ts`, or `desktop.ts` handler.** If
  you find yourself wanting to, the design is being exceeded — stop and ask. The
  one intended exception is comment text in Task 7.
- **The `expectDigest` handshake is load-bearing.** `Library.svelte` reads the
  extension source and holds the digest; `ExtensionReview.svelte` only displays
  it. Do not move the read into the component to "tidy it up" — that would break
  the guarantee that what was reviewed is what gets enabled.
- **Root passes `[]` for root prompts.** `promptItems(own, root, scope)` with
  root's own list in both arguments will list every root template twice. The
  ternary in `refresh()` is what prevents it.
- If a step's code does not compile against what you find in the repo, the repo
  is right and this plan is stale — fix the code to match reality and note it in
  the commit.
