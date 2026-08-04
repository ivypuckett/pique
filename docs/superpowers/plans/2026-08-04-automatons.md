# Automatons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `automatons` module: a named markdown file naming one prompt
template plus the exact extensions and skills a run may load, launchable by a
button, with runs that are listable and readable after the fact.

**Architecture:** An automaton is a per-scope markdown file resolved along
`chain()`, exactly as prompt templates are. A launch resolves its references to
concrete paths and tool groups, builds a `DefaultResourceLoader` with
`noExtensions`/`noSkills` set so the loaded set is exactly what was named, and
runs a pi session whose transcript persists as session JSONL beside a JSON run
record. `launchAutomaton()` is the single entry point later triggers will call.

**Tech Stack:** Deno, `@earendil-works/pi-coding-agent` 0.83, Svelte 5 (runes),
Tailwind + daisyUI, `deno test`.

**Design doc:**
[2026-08-04-automatons-design.md](../specs/2026-08-04-automatons-design.md)

---

## Decisions locked in before coding

Do not re-litigate these mid-task. All are from the design doc unless marked.

1. **`prompt:` is required and references a template.** The body is reserved and
   never interpreted.
2. **`noExtensions: true` and `noSkills: true` on every run.** An automaton
   naming nothing gets zero extensions — not the scope's set.
3. **An unresolvable reference raises before the session is created**, and the
   run is recorded `failed`. No silent skipping.
4. **`pique:` groups are named in the same `extensions:` list.** Three exist:
   `pique:kanban`, `pique:extension-authoring`, `pique:prompt-authoring`.
5. **A skill is named by path basename**, not by `SKILL.md` frontmatter `name:`.
6. **NEW, refining the design's resolution table: a package source must already
   be enabled in the scope.** The design said non-local, non-`pique:` refs "pass
   through as a package source". Taken literally an automaton naming
   `npm:anything` would make pi fetch and load unreviewed code, bypassing the
   review gate in Library → Extensions. `resolveExtensionRefs` therefore checks
   the ref against `listEnabledPackages(scope)` and raises when absent, matching
   how local names are checked against the live `extensions/` dir. Packages are
   not inherited, so this checks the launching scope only.
7. **Runs do not survive the app.** `reconcileRuns()` at startup turns a
   stranded `running` record into `failed`.

## File Structure

| File                                      | Change | Responsibility                                                      |
| ----------------------------------------- | ------ | ------------------------------------------------------------------- |
| `src/lib/skills/paths.ts`                 | New    | `skillsDir`, name validation                                        |
| `src/lib/skills/service.ts`               | New    | List a scope's skills; chain-resolve one by name                    |
| `src/lib/skills/bindings.ts`              | New    | Frontend half of the `skills*` contract                             |
| `src/lib/skills/Skills.svelte`            | New    | Read-only Library sub-tab                                           |
| `src/lib/automatons/paths.ts`             | New    | Every path keyed by scope                                           |
| `src/lib/automatons/parse.ts`             | New    | Pure file format — parse and serialize                              |
| `src/lib/automatons/service.ts`           | New    | List / read / save / delete; chain resolution                       |
| `src/lib/automatons/resolve.ts`           | New    | Refs → loader paths and `customTools`; raises on unresolvable       |
| `src/lib/automatons/run.ts`               | New    | Launch, drain, stop, run records, reconcile                         |
| `src/lib/automatons/bindings.ts`          | New    | Frontend half of the `automaton*` contract                          |
| `src/lib/automatons/Automatons.svelte`    | New    | The module: scope, list, launch, run rows, transcript               |
| `src/lib/automatons/AutomatonForm.svelte` | New    | The definition editor — pickers over prompts, extensions and skills |
| `src/lib/library/Library.svelte`          | Modify | Third sub-tab                                                       |
| `src/lib/modules/registry.ts`             | Modify | Register `automatons`                                               |
| `src/desktop.ts`                          | Modify | `automaton*` / `skills*` binds; `reconcileRuns()` after the imports |
| `src/lib/layout_test.ts`                  | Modify | Pin `moduleLabel("automatons")`                                     |
| `docs/automatons.md`                      | New    | Feature doc                                                         |
| `docs/scopes.md`                          | Modify | Inheritance rows                                                    |
| `README.md`                               | Modify | Module list and glossary                                            |

---

### Task 1: Skills listing

**Files:** Create `src/lib/skills/paths.ts`, `src/lib/skills/service.ts`,
`src/lib/skills/service_test.ts`

A skill on disk is either `<name>/SKILL.md` (a directory skill) or `<name>.md`
(a loose file) — pi's own two shapes, per its `loadSkillsFromDir` discovery
rules. This task only lists and resolves them; nothing installs or reviews.

- [ ] **Step 1: Write the failing test**

Create `src/lib/skills/service_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { listSkills, listVisibleSkills, resolveSkillPath } from "./service.ts";
import { skillsDir } from "./paths.ts";
import type { ScopeId } from "../scope/paths.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function writeDirSkill(
  scope: ScopeId,
  name: string,
  text: string,
): Promise<void> {
  await Deno.mkdir(`${skillsDir(scope)}/${name}`, { recursive: true });
  await Deno.writeTextFile(`${skillsDir(scope)}/${name}/SKILL.md`, text);
}

async function writeFileSkill(
  scope: ScopeId,
  name: string,
  text: string,
): Promise<void> {
  await Deno.mkdir(skillsDir(scope), { recursive: true });
  await Deno.writeTextFile(`${skillsDir(scope)}/${name}.md`, text);
}

Deno.test("a scope with no skills dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listSkills("ws-1"), []);
  });
});

Deno.test("both directory and loose-file skills are listed", async () => {
  await withTempHome(async () => {
    await writeDirSkill(
      "ws-1",
      "changelog-style",
      "---\ndescription: d1\n---\nbody",
    );
    await writeFileSkill("ws-1", "terse", "---\ndescription: d2\n---\nbody");

    assertEquals(
      (await listSkills("ws-1")).map((s) => ({
        name: s.name,
        description: s.description,
      })),
      [
        { name: "changelog-style", description: "d1" },
        { name: "terse", description: "d2" },
      ],
    );
  });
});

// Decision 5: the basename is the name. A frontmatter `name:` that disagrees is
// reported so the mismatch is visible, but it is NOT what the skill is named here.
Deno.test("a frontmatter name that disagrees with the basename is reported, not used", async () => {
  await withTempHome(async () => {
    await writeDirSkill(
      "ws-1",
      "changelog-style",
      "---\nname: something-else\n---\nb",
    );

    const [skill] = await listSkills("ws-1");
    assertEquals(skill.name, "changelog-style");
    assertEquals(skill.frontmatterName, "something-else");
  });
});

Deno.test("a workspace sees root's skills and its own, nearest name winning", async () => {
  await withTempHome(async () => {
    await writeDirSkill(
      "root",
      "shared",
      "---\ndescription: from root\n---\nb",
    );
    await writeDirSkill(
      "root",
      "overridden",
      "---\ndescription: from root\n---\nb",
    );
    await writeDirSkill(
      "ws-1",
      "overridden",
      "---\ndescription: from ws\n---\nb",
    );

    const byName = new Map(
      (await listVisibleSkills("ws-1")).map((s) => [s.name, s.description]),
    );
    assertEquals(byName.get("shared"), "from root");
    assertEquals(byName.get("overridden"), "from ws");
  });
});

Deno.test("resolveSkillPath prefers the nearest scope and returns undefined when absent", async () => {
  await withTempHome(async () => {
    await writeDirSkill("root", "shared", "---\n---\nb");
    await writeDirSkill("ws-1", "shared", "---\n---\nb");

    assertEquals(
      await resolveSkillPath("ws-1", "shared"),
      `${skillsDir("ws-1")}/shared`,
    );
    assertEquals(await resolveSkillPath("ws-1", "nope"), undefined);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test -A src/lib/skills/` Expected: FAIL —
`Module not found "./service.ts"`.

- [ ] **Step 3: Implement `paths.ts`**

Create `src/lib/skills/paths.ts`:

```ts
// On-disk location of a scope's skills. Deliberately INSIDE the scope's agent dir,
// because pi auto-discovers `<agentDir>/skills` and here that discovery is exactly
// what we want — the same reasoning that puts prompt templates there.
//
// pique lists and resolves skills; it does not install, review or quarantine them.
// A skill is markdown read by a model, not code that executes, so the extension
// review gate does not apply. Runs Deno-side only.
import { scopeAgentDir, type ScopeId } from "../scope/paths.ts";

// A skill name is a path basename AND the token an automaton names it by, so it is
// constrained the way a prompt template name is: no separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function skillsDir(scope: ScopeId): string {
  return `${scopeAgentDir(scope)}/skills`;
}

export function assertSkillName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid skill name: ${name}`);
}
```

- [ ] **Step 4: Implement `service.ts`**

Create `src/lib/skills/service.ts`:

```ts
// Backend service for skills: what a scope has, and where a named one lives.
// Read-only by design (docs/automatons.md) — the Library sub-tab shows this list and
// the automaton editor picks from it. Runs Deno-side only.
import { extract } from "@std/front-matter/yaml";
import { assertSkillName, skillsDir } from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

// A type alias, not an interface, so it keeps TypeScript's implicit index signature
// and can cross the win.bind boundary as a JSON value.
export type SkillInfo = {
  // The path basename. THIS is what an automaton names (design decision 5).
  name: string;
  description: string;
  // Absolute path to the skill dir or file, ready for pi's additionalSkillPaths.
  path: string;
  scope: ScopeId;
  // The frontmatter `name:` when it disagrees with the basename. Shown in the UI so
  // the divergence is visible rather than mysterious; never used for resolution.
  frontmatterName?: string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

// Frontmatter only; the body is the skill's text and is not needed for a listing.
// A file with no frontmatter, or malformed frontmatter, still lists — with an empty
// description — because the dir is user-editable and one bad file must not blank the
// whole list.
function meta(text: string): { description: string; frontmatterName?: string } {
  try {
    const attrs = extract(text).attrs as Record<string, unknown>;
    return {
      description: str(attrs.description) ?? "",
      frontmatterName: str(attrs.name),
    };
  } catch {
    return { description: "" };
  }
}

async function readMeta(
  path: string,
): Promise<{ description: string; frontmatterName?: string }> {
  try {
    return meta(await Deno.readTextFile(path));
  } catch {
    return { description: "" };
  }
}

// One scope's own skills. pi's two shapes: `<name>/SKILL.md` and a loose `<name>.md`.
// A missing dir means "none yet", not an error. A basename that is not a legal name
// is skipped rather than raising.
export async function listSkills(scope: ScopeId): Promise<SkillInfo[]> {
  const dir = skillsDir(scope);
  const out: SkillInfo[] = [];
  let entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  entries = entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    let name: string;
    let path: string;
    let metaPath: string;
    if (entry.isDirectory) {
      name = entry.name;
      path = `${dir}/${entry.name}`;
      metaPath = `${path}/SKILL.md`;
      try {
        if (!(await Deno.stat(metaPath)).isFile) continue;
      } catch {
        // A directory with no SKILL.md is not a skill — pi would recurse into it
        // looking for one, but a nested skill is not nameable here.
        continue;
      }
    } else if (entry.isFile && entry.name.endsWith(".md")) {
      name = entry.name.slice(0, -3);
      path = `${dir}/${entry.name}`;
      metaPath = path;
    } else continue;

    try {
      assertSkillName(name);
    } catch {
      continue;
    }
    out.push({ name, path, scope, ...await readMeta(metaPath) });
  }
  return out;
}

// Every skill nameable in `scope`: its own plus each ancestor's, nearest winning. The
// de-duplication matters — pi collapses a name collision itself and takes the first
// path, so listing a shadowed twin would offer something that can never be selected.
export async function listVisibleSkills(
  scope: ScopeId,
): Promise<SkillInfo[]> {
  const byName = new Map<string, SkillInfo>();
  for (const s of chain(scope)) {
    for (const skill of await listSkills(s)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

// The path an automaton's `skills:` entry resolves to, nearest scope first, or
// undefined when no scope on the chain has it. Undefined is what makes a launch fail
// loudly (automatons/resolve.ts) rather than run with less than its file says.
export async function resolveSkillPath(
  scope: ScopeId,
  name: string,
): Promise<string | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    const hit = (await listSkills(s)).find((k) => k.name === name);
    if (hit) return hit.path;
  }
  return undefined;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test -A src/lib/skills/` Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/skills && git commit -m "Add a chain-resolved skills listing"
```

---

### Task 2: The automaton file format

**Files:** Create `src/lib/automatons/paths.ts`, `src/lib/automatons/parse.ts`,
`src/lib/automatons/parse_test.ts`

Pure format work — no filesystem in `parse.ts`, so the format is testable alone.
Shaped on `prompts/parse.ts`, which does the same job for templates.

- [ ] **Step 1: Write the failing test**

Create `src/lib/automatons/parse_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { automatonFile, parseAutomaton } from "./parse.ts";

Deno.test("a full file parses into its four references", () => {
  const a = parseAutomaton(
    "triage",
    `---
description: Sorts new cards.
prompt: daily-triage
extensions: [pique:kanban, kanban_notes]
skills: [changelog-style]
---
`,
  );
  assertEquals(a.name, "triage");
  assertEquals(a.description, "Sorts new cards.");
  assertEquals(a.prompt, "daily-triage");
  assertEquals(a.extensions, ["pique:kanban", "kanban_notes"]);
  assertEquals(a.skills, ["changelog-style"]);
  assertEquals(a.error, undefined);
});

// Decision 2: absent lists are empty, and an empty list is a real, honoured value —
// it means "no extensions", not "the defaults".
Deno.test("absent extensions and skills default to empty", () => {
  const a = parseAutomaton("triage", "---\nprompt: p\n---\n");
  assertEquals(a.extensions, []);
  assertEquals(a.skills, []);
  assertEquals(a.description, "");
});

Deno.test("a missing prompt is an error, not a default", () => {
  const a = parseAutomaton("triage", "---\ndescription: d\n---\n");
  assertEquals(a.prompt, "");
  assertEquals(a.error, "prompt: required");
});

Deno.test("a file with no frontmatter at all is an error", () => {
  const a = parseAutomaton("triage", "just some text\n");
  assertEquals(a.error, "prompt: required");
});

Deno.test("malformed frontmatter is reported rather than silently ignored", () => {
  const a = parseAutomaton("triage", "---\nprompt: [unclosed\n---\n");
  assertEquals(a.prompt, "");
  assertEquals(a.error?.startsWith("frontmatter: "), true);
});

// Decision 2: the body is reserved. It is retained so nothing is lost on a
// round-trip, and it is never interpreted as prompt text.
Deno.test("the body is retained but is not the prompt", () => {
  const a = parseAutomaton("triage", "---\nprompt: p\n---\nsome notes\n");
  assertEquals(a.body, "some notes");
  assertEquals(a.prompt, "p");
});

Deno.test("non-string list entries are dropped rather than coerced", () => {
  const a = parseAutomaton(
    "triage",
    "---\nprompt: p\nextensions: [ok, 3, null]\n---\n",
  );
  assertEquals(a.extensions, ["ok"]);
});

Deno.test("unknown keys are ignored", () => {
  const a = parseAutomaton("triage", "---\nprompt: p\nmystery: 1\n---\n");
  assertEquals(a.prompt, "p");
  assertEquals(a.error, undefined);
});

Deno.test("automatonFile round-trips through parseAutomaton", () => {
  const text = automatonFile({
    description: 'has "quotes" and, commas',
    prompt: "daily-triage",
    extensions: ["pique:kanban"],
    skills: [],
  });
  const a = parseAutomaton("triage", text);
  assertEquals(a.description, 'has "quotes" and, commas');
  assertEquals(a.prompt, "daily-triage");
  assertEquals(a.extensions, ["pique:kanban"]);
  assertEquals(a.skills, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test -A src/lib/automatons/` Expected: FAIL —
`Module not found "./parse.ts"`.

- [ ] **Step 3: Implement `paths.ts`**

Create `src/lib/automatons/paths.ts`:

```ts
// On-disk locations for a scope's automatons. Four dirs under the scope:
//
//   automatons/            LIVE definitions — launchable.
//   automatons/pending/    QUARANTINE. Reserved: nothing writes here until
//                          define_automaton exists. It is created now so the live
//                          listing globs `automatons/*.md` non-recursively from the
//                          start, the way prompts/ and extensions/ already do.
//   automatons/runs/       One JSON record per run.
//   automatons/sessions/   pi session JSONL — the transcripts.
//
// Deliberately OUTSIDE the scope's agent/ dir: pi auto-discovers inside an agentDir,
// and a directory of markdown there invites it to interpret these files. Runs
// Deno-side only.
import { scopeDir, type ScopeId } from "../scope/paths.ts";

// The filename minus `.md` is the name, so it is constrained the way a prompt
// template name is: no separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function automatonsDir(scope: ScopeId): string {
  return `${scopeDir(scope)}/automatons`;
}

export function pendingDir(scope: ScopeId): string {
  return `${automatonsDir(scope)}/pending`;
}

export function runsDir(scope: ScopeId): string {
  return `${automatonsDir(scope)}/runs`;
}

export function sessionsDir(scope: ScopeId): string {
  return `${automatonsDir(scope)}/sessions`;
}

export function assertAutomatonName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid automaton name: ${name}`);
}

export function automatonPath(scope: ScopeId, name: string): string {
  assertAutomatonName(name);
  return `${automatonsDir(scope)}/${name}.md`;
}

// A run id is generated (crypto.randomUUID) rather than user-supplied, so it needs no
// validation beyond the shape it is given in run.ts.
export function runPath(scope: ScopeId, runId: string): string {
  if (!/^[a-z0-9-]+$/.test(runId)) throw new Error(`invalid run id: ${runId}`);
  return `${runsDir(scope)}/${runId}.json`;
}

export async function ensureAutomatonDirs(scope: ScopeId): Promise<void> {
  await Deno.mkdir(pendingDir(scope), { recursive: true });
  await Deno.mkdir(runsDir(scope), { recursive: true });
  await Deno.mkdir(sessionsDir(scope), { recursive: true });
}
```

- [ ] **Step 4: Implement `parse.ts`**

Create `src/lib/automatons/parse.ts`:

```ts
// The automaton file format, and nothing else. Pure — no filesystem, no pi — so the
// format is testable on its own. Shaped on prompts/parse.ts.
//
// An automaton is four references: a prompt template to send, the extensions and
// skills the run may load, and a description for the human reading the list. The BODY
// IS RESERVED: it is retained so a round-trip loses nothing, and it is never sent to a
// model. `prompt:` is what runs (docs/automatons.md).
import { extract } from "@std/front-matter/yaml";

// A type alias rather than an interface, so it keeps TypeScript's implicit index
// signature and can cross the win.bind boundary as a JSON value.
export type Automaton = {
  name: string;
  description: string;
  // The prompt template this sends. Required; "" only when `error` is set.
  prompt: string;
  extensions: string[];
  skills: string[];
  // Reserved. Never interpreted; see the module comment.
  body: string;
  // Set when the file cannot be launched as written. The automaton is still returned
  // so the UI can show what is wrong instead of hiding the file.
  error?: string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

// A list of strings, dropping anything else. A YAML list holding a number is a typo,
// not an instruction, and coercing it would invent a reference nobody wrote.
function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((e): e is string => typeof e === "string")
    : [];
}

export function parseAutomaton(name: string, text: string): Automaton {
  const empty = {
    name,
    description: "",
    prompt: "",
    extensions: [],
    skills: [],
  };
  let attrs: Record<string, unknown> = {};
  let body = text;
  try {
    // Throws on a file with no frontmatter, and on malformed YAML. Unlike a prompt
    // template — which is legitimately body-only — an automaton with no frontmatter
    // carries no `prompt:` and so cannot run either way; the distinction only changes
    // which error the UI shows.
    const extracted = extract(text);
    attrs = extracted.attrs as Record<string, unknown>;
    body = extracted.body;
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      return {
        ...empty,
        body: text.trim(),
        error: `frontmatter: ${(err as Error).message}`,
      };
    }
    return { ...empty, body: text.trim(), error: "prompt: required" };
  }
  const prompt = str(attrs.prompt) ?? "";
  return {
    name,
    description: str(attrs.description) ?? "",
    prompt,
    extensions: strList(attrs.extensions),
    skills: strList(attrs.skills),
    body: body.trim(),
    error: prompt ? undefined : "prompt: required",
  };
}

// Serialize back to the on-disk format. Frontmatter is emitted by hand rather than
// with a YAML writer, as prompts/parse.ts does: the schema is four keys wide, and
// JSON's encoding of a string is valid YAML flow syntax — which is what keeps a
// description holding `---` or a newline inside its quoted scalar.
//
// The body is not written. It is reserved (see the module comment), and the editor
// has no field for it, so emitting one would create content nothing can edit.
export function automatonFile(
  a: {
    description: string;
    prompt: string;
    extensions: string[];
    skills: string[];
  },
): string {
  const list = (xs: string[]) =>
    `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  return [
    "---",
    `description: ${JSON.stringify(a.description)}`,
    `prompt: ${JSON.stringify(a.prompt)}`,
    `extensions: ${list(a.extensions)}`,
    `skills: ${list(a.skills)}`,
    "---",
    "",
  ].join("\n");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `deno test -A src/lib/automatons/` Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/automatons && git commit -m "Add the automaton file format"
```

---

### Task 3: The automaton service

**Files:** Create `src/lib/automatons/service.ts`,
`src/lib/automatons/service_test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/automatons/service_test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import {
  deleteAutomaton,
  listAutomatons,
  listVisibleAutomatons,
  resolveAutomaton,
  saveAutomaton,
} from "./service.ts";
import { automatonPath, ensureAutomatonDirs, pendingDir } from "./paths.ts";
import type { ScopeId } from "../scope/paths.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function write(
  scope: ScopeId,
  name: string,
  text: string,
): Promise<void> {
  await ensureAutomatonDirs(scope);
  await Deno.writeTextFile(automatonPath(scope, name), text);
}

Deno.test("a scope with no automatons dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listAutomatons("ws-1"), []);
  });
});

Deno.test("automatons are listed with their scope", async () => {
  await withTempHome(async () => {
    await write("ws-1", "triage", "---\nprompt: p\n---\n");

    const [a] = await listAutomatons("ws-1");
    assertEquals(a.name, "triage");
    assertEquals(a.scope, "ws-1");
  });
});

// The quarantine dir is created by ensureAutomatonDirs but nothing writes to it yet.
// This pins that a file placed there by hand is never launchable.
Deno.test("a file in pending/ is never listed as live", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await Deno.writeTextFile(
      `${pendingDir("ws-1")}/sneaky.md`,
      "---\nprompt: p\n---\n",
    );

    assertEquals(await listAutomatons("ws-1"), []);
    assertEquals(await resolveAutomaton("ws-1", "sneaky"), undefined);
  });
});

Deno.test("a workspace sees root's automatons and its own, nearest name winning", async () => {
  await withTempHome(async () => {
    await write("root", "shared", "---\nprompt: from-root\n---\n");
    await write("root", "overridden", "---\nprompt: from-root\n---\n");
    await write("ws-1", "overridden", "---\nprompt: from-ws\n---\n");

    const byName = new Map(
      (await listVisibleAutomatons("ws-1")).map((a) => [a.name, a.prompt]),
    );
    assertEquals(byName.get("shared"), "from-root");
    assertEquals(byName.get("overridden"), "from-ws");
    assertEquals(byName.size, 2);
  });
});

Deno.test("resolveAutomaton prefers the nearest scope", async () => {
  await withTempHome(async () => {
    await write("root", "shared", "---\nprompt: from-root\n---\n");
    await write("ws-1", "shared", "---\nprompt: from-ws\n---\n");

    assertEquals((await resolveAutomaton("ws-1", "shared"))?.prompt, "from-ws");
    assertEquals(
      (await resolveAutomaton("root", "shared"))?.prompt,
      "from-root",
    );
  });
});

Deno.test("save then delete round-trips", async () => {
  await withTempHome(async () => {
    await saveAutomaton("ws-1", "triage", {
      description: "d",
      prompt: "daily-triage",
      extensions: ["pique:kanban"],
      skills: [],
    });
    assertEquals((await resolveAutomaton("ws-1", "triage"))?.extensions, [
      "pique:kanban",
    ]);

    await deleteAutomaton("ws-1", "triage");
    assertEquals(await resolveAutomaton("ws-1", "triage"), undefined);
  });
});

Deno.test("an illegal name is rejected on save", async () => {
  await withTempHome(async () => {
    await assertRejects(() =>
      saveAutomaton("ws-1", "../escape", {
        description: "",
        prompt: "p",
        extensions: [],
        skills: [],
      })
    );
  });
});

Deno.test("a stray file with an illegal basename is skipped, not fatal", async () => {
  await withTempHome(async () => {
    await write("ws-1", "triage", "---\nprompt: p\n---\n");
    await Deno.writeTextFile(
      `${
        automatonPath("ws-1", "triage").replace("triage.md", "Not A Name.md")
      }`,
      "---\nprompt: p\n---\n",
    );

    assertEquals((await listAutomatons("ws-1")).map((a) => a.name), ["triage"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test -A src/lib/automatons/service_test.ts` Expected: FAIL —
`Module not found "./service.ts"`.

- [ ] **Step 3: Implement**

Create `src/lib/automatons/service.ts`:

```ts
// Backend service for automatons: what a scope has, and reading/writing one. The
// automaton* win.bind handlers (desktop.ts) are its only caller besides run.ts.
// Shaped on prompts/service.ts, which does the same job for templates.
//
// There is no approve/reject pair here. `pending/` exists (paths.ts) but nothing
// writes into it until define_automaton lands, so quarantine has no lifecycle yet —
// only the guarantee that a file there is not launchable. Runs Deno-side only.
import { type Automaton, automatonFile, parseAutomaton } from "./parse.ts";
import {
  assertAutomatonName,
  automatonPath,
  automatonsDir,
  ensureAutomatonDirs,
} from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

// An alias, not an interface, for the same reason Automaton is one (parse.ts).
export type AutomatonInfo = Automaton & { scope: ScopeId };

// Definition names are the `*.md` basenames in the live dir. A missing dir means
// "none yet", not an error. A basename that is not a legal name is skipped rather
// than raising — the dir is user-editable and one stray file must not break the list.
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const name = entry.name.slice(0, -3);
      try {
        assertAutomatonName(name);
      } catch {
        continue;
      }
      names.push(name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return names.sort();
}

// One scope's own automatons. The listing globs the live dir without recursing, so
// `pending/` can never appear here.
export async function listAutomatons(scope: ScopeId): Promise<AutomatonInfo[]> {
  const names = await namesIn(automatonsDir(scope));
  return await Promise.all(names.map(async (name) => ({
    ...parseAutomaton(
      name,
      await Deno.readTextFile(automatonPath(scope, name)),
    ),
    scope,
  })));
}

// Every automaton launchable in `scope`: its own plus each ancestor's, nearest
// winning. Chain order is furthest-first, so a later set() shadows an earlier one.
export async function listVisibleAutomatons(
  scope: ScopeId,
): Promise<AutomatonInfo[]> {
  const byName = new Map<string, AutomatonInfo>();
  for (const s of chain(scope)) {
    for (const a of await listAutomatons(s)) byName.set(a.name, a);
  }
  return [...byName.values()];
}

// The definition a launch runs, nearest scope first, or undefined when no scope on
// the chain has it. `scope` on the result is where the FILE lives, which may be an
// ancestor; the run itself always belongs to the launching scope (run.ts).
export async function resolveAutomaton(
  scope: ScopeId,
  name: string,
): Promise<AutomatonInfo | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    const hit = (await listAutomatons(s)).find((a) => a.name === name);
    if (hit) return hit;
  }
  return undefined;
}

// Write a definition into the live dir, creating or replacing it. Human path only;
// there is no agent path yet.
export async function saveAutomaton(
  scope: ScopeId,
  name: string,
  a: {
    description: string;
    prompt: string;
    extensions: string[];
    skills: string[];
  },
): Promise<void> {
  assertAutomatonName(name);
  await ensureAutomatonDirs(scope);
  await Deno.writeTextFile(automatonPath(scope, name), automatonFile(a));
}

export async function deleteAutomaton(
  scope: ScopeId,
  name: string,
): Promise<void> {
  await Deno.remove(automatonPath(scope, name));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/automatons/` Expected: PASS, 17 tests (9 from Task 2
plus 8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/automatons && git commit -m "Add the automaton service"
```

---

### Task 4: Reference resolution

**Files:** Create `src/lib/automatons/resolve.ts`,
`src/lib/automatons/resolve_test.ts`

This is where decision 3 (exactly what is named) and decision 6 (a package must
already be enabled) are enforced. Everything raises rather than skipping.

- [ ] **Step 1: Write the failing test**

Create `src/lib/automatons/resolve_test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import {
  BUILTIN_GROUPS,
  resolveExtensionRefs,
  resolveSkillRefs,
} from "./resolve.ts";
import {
  ensureExtensionDirs,
  livePath,
  pendingPath,
} from "../extensions/paths.ts";
import { skillsDir } from "../skills/paths.ts";
import type { ScopeId } from "../scope/paths.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function writeExt(
  scope: ScopeId,
  name: string,
  state: "enabled" | "pending" = "enabled",
): Promise<void> {
  await ensureExtensionDirs(scope);
  const path = state === "enabled"
    ? livePath(scope, name)
    : pendingPath(scope, name);
  await Deno.writeTextFile(path, "export default () => {};\n");
}

async function writeSkill(scope: ScopeId, name: string): Promise<void> {
  await Deno.mkdir(`${skillsDir(scope)}/${name}`, { recursive: true });
  await Deno.writeTextFile(
    `${skillsDir(scope)}/${name}/SKILL.md`,
    "---\n---\nb",
  );
}

Deno.test("the three pique: groups resolve to tool definitions, not paths", async () => {
  await withTempHome(async () => {
    const r = await resolveExtensionRefs("ws-1", [
      "pique:kanban",
      "pique:extension-authoring",
      "pique:prompt-authoring",
    ]);
    assertEquals(r.extensionPaths, []);
    // Each group contributes at least one tool; the exact count is the groups' business.
    assertEquals(r.customTools.length > 0, true);
    assertEquals(Object.keys(BUILTIN_GROUPS).sort(), [
      "extension-authoring",
      "kanban",
      "prompt-authoring",
    ]);
  });
});

Deno.test("an unknown pique: group raises", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["pique:nope"]),
      Error,
      "pique:nope",
    );
  });
});

Deno.test("a local extension name resolves to its live file path", async () => {
  await withTempHome(async () => {
    await writeExt("ws-1", "kanban_notes");

    const r = await resolveExtensionRefs("ws-1", ["kanban_notes"]);
    assertEquals(r.extensionPaths, [livePath("ws-1", "kanban_notes")]);
  });
});

Deno.test("a local extension is inherited from root and the nearest scope wins", async () => {
  await withTempHome(async () => {
    await writeExt("root", "shared");
    assertEquals(
      (await resolveExtensionRefs("ws-1", ["shared"])).extensionPaths,
      [livePath("root", "shared")],
    );

    await writeExt("ws-1", "shared");
    assertEquals(
      (await resolveExtensionRefs("ws-1", ["shared"])).extensionPaths,
      [livePath("ws-1", "shared")],
    );
  });
});

// The review gate: quarantined code is not nameable, so an automaton cannot run an
// extension a human has not enabled.
Deno.test("a pending extension is not nameable", async () => {
  await withTempHome(async () => {
    await writeExt("ws-1", "unreviewed", "pending");

    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["unreviewed"]),
      Error,
      "unreviewed",
    );
  });
});

Deno.test("an unresolvable name raises rather than being skipped", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["nope"]),
      Error,
      "nope",
    );
  });
});

// Decision 6. Without this an automaton file naming npm:anything would make pi fetch
// and load unreviewed code, bypassing Library → Extensions entirely.
Deno.test("a package source that is not enabled in the scope raises", async () => {
  await withTempHome(async () => {
    await assertRejects(
      () => resolveExtensionRefs("ws-1", ["npm:pi-crew"]),
      Error,
      "npm:pi-crew",
    );
  });
});

Deno.test("skills resolve to paths and an unknown one raises", async () => {
  await withTempHome(async () => {
    await writeSkill("root", "changelog-style");

    assertEquals(await resolveSkillRefs("ws-1", ["changelog-style"]), [
      `${skillsDir("root")}/changelog-style`,
    ]);
    await assertRejects(
      () => resolveSkillRefs("ws-1", ["nope"]),
      Error,
      "nope",
    );
  });
});

Deno.test("empty ref lists resolve to empty, which is a real capability set", async () => {
  await withTempHome(async () => {
    const r = await resolveExtensionRefs("ws-1", []);
    assertEquals(r.extensionPaths, []);
    assertEquals(r.customTools, []);
    assertEquals(await resolveSkillRefs("ws-1", []), []);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test -A src/lib/automatons/resolve_test.ts` Expected: FAIL —
`Module not found "./resolve.ts"`.

- [ ] **Step 3: Implement**

Create `src/lib/automatons/resolve.ts`:

```ts
// An automaton's `extensions:` and `skills:` references → the concrete paths and tool
// groups a run is built from. This module is where "exactly what it names" is
// enforced: every ref must resolve, and an unresolvable one RAISES.
//
// Raising rather than skipping is deliberate and is the one behaviour that must not be
// softened. Profiles ignored unknown names silently, and their own design doc records
// how undebuggable that was; an automaton runs unattended, where a run that quietly
// does less than its file says is worse than one that does not start.
//
// Three ref shapes, checked in order:
//
//   pique:<group>   a compiled-in tool group (customTools, not a path)
//   <local name>    a `.ts` module in a scope's LIVE extensions dir, chain-resolved
//   anything else   a package source, which must already be enabled in this scope
//
// The last check is what stops an automaton from being a way around the review gate:
// pi would happily fetch and load `npm:anything` handed to additionalExtensionPaths.
// Packages are not inherited (docs/extensions.md), so only the launching scope counts.
// Runs Deno-side only.
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { kanbanTools } from "../kanban/agent-tools.ts";
import { extensionAuthoringTools } from "../extensions/agent-tools.ts";
import { promptAuthoringTools } from "../prompts/agent-tools.ts";
import { listEnabledPackages } from "../extensions/packages.ts";
import { livePath } from "../extensions/paths.ts";
import { resolveSkillPath } from "../skills/service.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

// pique's compiled-in tool groups, nameable exactly as extensions are. Every group is
// scope-bound: it acts on the scope the run belongs to.
export const BUILTIN_GROUPS: Record<
  string,
  (scope: ScopeId) => ToolDefinition[]
> = {
  "kanban": kanbanTools,
  "extension-authoring": extensionAuthoringTools,
  "prompt-authoring": promptAuthoringTools,
};

// A local extension name — the shape extensions/paths.ts constrains filenames to. The
// `pique:` prefix cannot collide with one, because this admits no colon.
const LOCAL_NAME_RE = /^[a-z][a-z0-9_]*$/;

export type ResolvedRefs = {
  // For DefaultResourceLoader's additionalExtensionPaths: absolute file paths for
  // local modules, and source strings for packages. pi accepts both — every entry
  // goes through resolveExtensionSources, which treats it as a package source.
  extensionPaths: string[];
  // For createAgentSession's customTools.
  customTools: ToolDefinition[];
};

// The live path of a local extension, nearest scope first, or undefined. Only the
// LIVE dir is consulted: a pending or revoked module is not nameable, which is what
// keeps the review gate meaningful.
async function resolveLocal(
  scope: ScopeId,
  name: string,
): Promise<string | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    const path = livePath(s, name);
    try {
      if ((await Deno.stat(path)).isFile) return path;
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function resolveExtensionRefs(
  scope: ScopeId,
  refs: string[],
): Promise<ResolvedRefs> {
  const extensionPaths: string[] = [];
  const customTools: ToolDefinition[] = [];
  // Fetched once rather than per ref: listing packages builds a pi package manager.
  let enabled: string[] | undefined;

  for (const ref of refs) {
    if (ref.startsWith("pique:")) {
      const group = BUILTIN_GROUPS[ref.slice("pique:".length)];
      if (!group) {
        throw new Error(
          `unknown built-in group: ${ref} (known: ${
            Object.keys(BUILTIN_GROUPS).map((g) => `pique:${g}`).join(", ")
          })`,
        );
      }
      customTools.push(...group(scope));
      continue;
    }

    if (LOCAL_NAME_RE.test(ref)) {
      const path = await resolveLocal(scope, ref);
      if (!path) {
        throw new Error(
          `extension not found or not enabled: ${ref} (enable it in Library → Extensions)`,
        );
      }
      extensionPaths.push(path);
      continue;
    }

    enabled ??= (await listEnabledPackages(scope)).map((p) => p.source);
    if (!enabled.includes(ref)) {
      throw new Error(
        `package not enabled in this scope: ${ref} (enable it in Library → Extensions)`,
      );
    }
    extensionPaths.push(ref);
  }
  return { extensionPaths, customTools };
}

// Skill refs → paths for additionalSkillPaths, which accepts directories as well as
// files. Named by path basename, never by SKILL.md frontmatter (skills/service.ts).
export async function resolveSkillRefs(
  scope: ScopeId,
  refs: string[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const ref of refs) {
    const path = await resolveSkillPath(scope, ref);
    if (!path) throw new Error(`skill not found: ${ref}`);
    paths.push(path);
  }
  return paths;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/automatons/resolve_test.ts` Expected: PASS, 9 tests.

If "the three pique: groups" fails on an import cycle, check that
`extensions/agent-tools.ts` and `prompts/agent-tools.ts` export the names used
here — they are `extensionAuthoringTools` and `promptAuthoringTools`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/automatons && git commit -m "Resolve automaton refs, raising on anything unresolvable"
```

---

### Task 5: The run engine

**Files:** Create `src/lib/automatons/run.ts`, `src/lib/automatons/run_test.ts`

Shaped on `chat/agent.ts`: a `Map` of live runs, a per-run event queue, a 20s
long-poll drain. What is new is the on-disk record, which is what makes a run
listable after a restart.

- [ ] **Step 1: Write the failing test**

`run_test.ts` covers the record lifecycle only — a real launch needs a model and
is covered by the integration test in Task 6.

Create `src/lib/automatons/run_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { listRuns, reconcileRuns, writeRunRecord } from "./run.ts";
import { ensureAutomatonDirs } from "./paths.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a scope with no runs dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listRuns("ws-1"), []);
  });
});

Deno.test("runs are listed newest first", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "done",
      startedAt: "2026-08-04T10:00:00.000Z",
      trigger: "manual",
    });
    await writeRunRecord("ws-1", {
      id: "bbb",
      automaton: "triage",
      status: "done",
      startedAt: "2026-08-04T11:00:00.000Z",
      trigger: "manual",
    });

    assertEquals((await listRuns("ws-1")).map((r) => r.id), ["bbb", "aaa"]);
  });
});

// Decision 7: a run cannot outlive the app, so a `running` record found at startup
// describes nothing. Leaving it would show a row that never changes.
Deno.test("reconcileRuns turns a stranded running record into failed", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "running",
      startedAt: "2026-08-04T10:00:00.000Z",
      trigger: "manual",
    });

    await reconcileRuns();

    const [run] = await listRuns("ws-1");
    assertEquals(run.status, "failed");
    assertEquals(run.error, "interrupted by shutdown");
    assertEquals(typeof run.endedAt, "string");
  });
});

Deno.test("reconcileRuns leaves finished records alone", async () => {
  await withTempHome(async () => {
    await ensureAutomatonDirs("ws-1");
    await writeRunRecord("ws-1", {
      id: "aaa",
      automaton: "triage",
      status: "done",
      startedAt: "2026-08-04T10:00:00.000Z",
      endedAt: "2026-08-04T10:01:00.000Z",
      trigger: "manual",
    });

    await reconcileRuns();

    assertEquals((await listRuns("ws-1"))[0].status, "done");
  });
});

Deno.test("reconcileRuns with no scopes dir is a no-op rather than a failure", async () => {
  await withTempHome(async () => {
    await reconcileRuns();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `deno test -A src/lib/automatons/run_test.ts` Expected: FAIL —
`Module not found "./run.ts"`.

- [ ] **Step 3: Implement**

Create `src/lib/automatons/run.ts`:

```ts
// Launching and tracking automaton runs. Deno-side only.
//
// Shaped on chat/agent.ts — a Map of live sessions, a per-run event queue, a 20s
// long-poll drain — with one addition: a JSON record per run on disk, which is what
// makes yesterday's runs listable after a restart. The in-memory Map holds only live
// runs; the records outlive the process.
//
// `launchAutomaton` is the SINGLE entry point. The button calls it today; a kanban
// card reaching a column and a cron schedule will call the same function, which is
// why `trigger` is recorded from the first run rather than added later.
//
// A run cannot outlive the app (docs/automatons.md deferred): quitting mid-run leaves
// a `running` record describing nothing, which reconcileRuns() fixes at startup.
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  type ChatEvent,
  ensureRuntime,
  type Item,
  resolveChatDefaults,
  toFrontendEvent,
  toHistory,
} from "../chat/agent.ts";
import { resolveAutomaton } from "./service.ts";
import { resolveExtensionRefs, resolveSkillRefs } from "./resolve.ts";
import { ensureAutomatonDirs, runPath, runsDir, sessionsDir } from "./paths.ts";
import { inheritedPromptDirs } from "../prompts/service.ts";
import { resolveScopeConfig } from "../scope/config.ts";
import { resolveBasePrompt } from "../scope/prompt.ts";
import {
  ensureScopeDirs,
  scopeAgentDir,
  type ScopeId,
  scopesDir,
} from "../scope/paths.ts";

export type RunStatus = "running" | "done" | "failed" | "stopped";

// A type alias, not an interface, so it crosses the win.bind boundary as JSON.
export type RunRecord = {
  id: string;
  automaton: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
  // "manual" today; "kanban" / "cron" once those triggers exist. Recorded from the
  // first run so the record shape does not change when they land.
  trigger: string;
  args?: string;
};

// deno-lint-ignore no-explicit-any
type Session = any;

interface Run {
  scope: ScopeId;
  session: Session;
  unsubscribe: () => void;
  queue: ChatEvent[];
}
const runs = new Map<string, Run>();

export async function writeRunRecord(
  scope: ScopeId,
  record: RunRecord,
): Promise<void> {
  await Deno.writeTextFile(
    runPath(scope, record.id),
    JSON.stringify(record, null, 2),
  );
}

async function patchRunRecord(
  scope: ScopeId,
  id: string,
  patch: Partial<RunRecord>,
): Promise<void> {
  try {
    const current = JSON.parse(
      await Deno.readTextFile(runPath(scope, id)),
    ) as RunRecord;
    await writeRunRecord(scope, { ...current, ...patch });
  } catch {
    // The record was deleted under us. A run whose record is gone has nothing to
    // update; losing the status is better than failing the run that produced it.
  }
}

// A scope's runs, newest first. A record that does not parse is skipped rather than
// raising: the dir is user-visible, and one bad file must not blank the list.
export async function listRuns(scope: ScopeId): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  try {
    for await (const entry of Deno.readDir(runsDir(scope))) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
        out.push(
          JSON.parse(
            await Deno.readTextFile(`${runsDir(scope)}/${entry.name}`),
          ) as RunRecord,
        );
      } catch {
        continue;
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// Startup repair. Every `running` record belongs to a process that no longer exists,
// because runs live in this process's memory. Called once from desktop.ts, AFTER the
// binds are registered (that file's first constraint).
export async function reconcileRuns(): Promise<void> {
  const scopes: string[] = [];
  try {
    for await (const entry of Deno.readDir(scopesDir())) {
      if (entry.isDirectory) scopes.push(entry.name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }
  for (const scope of scopes) {
    for (const run of await listRuns(scope)) {
      if (run.status !== "running") continue;
      await patchRunRecord(scope, run.id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: "interrupted by shutdown",
      });
    }
  }
}

// Launch `name` in `scope` and return the run id. Everything the run can reach —
// model, base prompt, board, working directory — resolves against `scope`, even when
// the definition itself was inherited from an ancestor.
//
// Resolution happens BEFORE the session is created, so a bad reference fails the
// launch with a recorded reason instead of producing a session quietly missing a
// capability its file names.
export async function launchAutomaton(
  opts: {
    scope: ScopeId;
    name: string;
    cwd: string;
    args?: string;
    trigger?: string;
  },
): Promise<string> {
  const { scope, name, cwd, args } = opts;
  const trigger = opts.trigger ?? "manual";
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await ensureScopeDirs(scope);
  await ensureAutomatonDirs(scope);

  const fail = async (message: string): Promise<never> => {
    await writeRunRecord(scope, {
      id,
      automaton: name,
      status: "failed",
      startedAt,
      endedAt: new Date().toISOString(),
      error: message,
      trigger,
      args,
    });
    throw new Error(message);
  };

  const def = await resolveAutomaton(scope, name);
  if (!def) return await fail(`automaton not found: ${name}`);
  if (def.error) return await fail(def.error);

  let extensionPaths: string[];
  let customTools: Awaited<
    ReturnType<typeof resolveExtensionRefs>
  >["customTools"];
  let skillPaths: string[];
  try {
    ({ extensionPaths, customTools } = await resolveExtensionRefs(
      scope,
      def.extensions,
    ));
    skillPaths = await resolveSkillRefs(scope, def.skills);
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }

  const modelRuntime = await ensureRuntime();
  const { provider, modelId, thinking } = resolveChatDefaults(
    await resolveScopeConfig(scope),
  );
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) return await fail(`model unavailable: ${provider}/${modelId}`);

  // The capability set. `noExtensions` and `noSkills` make the loaded set EXACTLY the
  // additional* paths — nothing from the scope's own agentDir, nothing from packages
  // it enabled for chat. That is the whole point of an automaton (design decision 3).
  //
  // These govern extension- and skill-provided capability only. pi's builtins (read,
  // write, edit, bash) are in every session regardless — see docs/extensions.md
  // deferred #1. This is not a sandbox and must not be described as one.
  //
  // noPromptTemplates stays OFF and the prompt dirs are passed, because that is how
  // `prompt:` resolves: the first message is `/<template> <args>` and pi's own
  // expander does the rest.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: scopeAgentDir(scope),
    noExtensions: true,
    noSkills: true,
    additionalExtensionPaths: extensionPaths,
    additionalSkillPaths: skillPaths,
    additionalPromptTemplatePaths: [
      ...inheritedPromptDirs(scope),
      `${scopeAgentDir(scope)}/prompts`,
    ],
    systemPrompt: await resolveBasePrompt(scope),
  });
  // createAgentSession only reloads a loader it creates itself, so ours must be
  // reloaded by hand or it yields no extensions at all.
  await resourceLoader.reload();

  const created = await createAgentSession({
    model,
    cwd,
    customTools,
    agentDir: scopeAgentDir(scope),
    resourceLoader,
    // Every run is its own session file — `create`, never `continueRecent`. A run is a
    // job with a beginning, not a conversation to pick back up.
    sessionManager: SessionManager.create(cwd, sessionsDir(scope)),
    modelRuntime,
  });
  const session = created.session;
  const queue: ChatEvent[] = [];
  const unsubscribe = session.subscribe((event: unknown) => {
    const mapped = toFrontendEvent(event);
    if (mapped) queue.push(mapped);
  });
  session.setThinkingLevel(thinking);
  runs.set(id, { scope, session, unsubscribe, queue });

  await writeRunRecord(scope, {
    id,
    automaton: name,
    status: "running",
    startedAt,
    trigger,
    args,
  });

  // Not awaited: the launch returns as soon as the run is under way, and completion is
  // reported by the record plus a terminal event on the queue. session.prompt() runs
  // whether or not anyone drains, which is what lets an unattended run finish.
  const message = args ? `/${def.prompt} ${args}` : `/${def.prompt}`;
  session
    .prompt(message)
    .then(async () => {
      const errorMessage = session.agent?.state?.errorMessage;
      queue.push(
        errorMessage
          ? { kind: "error", message: String(errorMessage) }
          : { kind: "done" },
      );
      await patchRunRecord(scope, id, {
        status: errorMessage ? "failed" : "done",
        endedAt: new Date().toISOString(),
        error: errorMessage ? String(errorMessage) : undefined,
      });
    })
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      queue.push({ kind: "error", message });
      await patchRunRecord(scope, id, {
        status: "failed",
        endedAt: new Date().toISOString(),
        error: message,
      });
    });

  return id;
}

// Long-poll drain, identical in shape to chat's readAgent: queued events, or [] after
// ~20s so the frontend re-polls. An unknown id (a finished run) drains as [].
export async function readRun(id: string): Promise<ChatEvent[]> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const queue = runs.get(id)?.queue;
    if (!queue) return [];
    if (queue.length) return queue.splice(0, queue.length);
    await new Promise((r) => setTimeout(r, 15));
  }
  return [];
}

// The transcript of a live run, for the frontend to render before any new event
// arrives. A finished run's transcript is read from its session JSONL instead.
export function runHistory(id: string): Item[] {
  return toHistory(runs.get(id)?.session.messages ?? []);
}

export async function stopRun(id: string): Promise<void> {
  const run = runs.get(id);
  if (!run) return;
  await run.session.abort();
  run.unsubscribe();
  runs.delete(id);
  await patchRunRecord(run.scope, id, {
    status: "stopped",
    endedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test -A src/lib/automatons/run_test.ts` Expected: PASS, 5 tests.

- [ ] **Step 5: Check the whole module compiles**

Run: `deno check src/lib/automatons/run.ts` Expected: clean. If `Item` or
`ChatEvent` fails to import, confirm both are exported from
`src/lib/chat/agent.ts` — they are, as `export type`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/automatons && git commit -m "Add the automaton run engine"
```

---

### Task 6: The integration test that proves the design

**Files:** Create `src/lib/automatons/run_integration_test.ts`

This is the claim the feature exists to make. Without it the design is
unverified: everything above would pass equally well if `noExtensions` merely
_added_ to the scope's set instead of replacing it.

Shaped on `src/lib/chat/scope_integration_test.ts` — read that file first for
the `withTempHome` + real-session idiom it already uses.

- [ ] **Step 1: Write the test**

Create `src/lib/automatons/run_integration_test.ts`:

```ts
// The claim automatons exist to make, through a real pi session: the loaded extension
// set is EXACTLY what the file names. Everything else in this module would pass just
// as well if noExtensions merely added to the scope's own set.
//
// Shaped on chat/scope_integration_test.ts, which asserts the opposite property for
// chat (that a scope's extensions DO reach its agent).
import { assertEquals } from "@std/assert";
import { launchAutomaton, stopRun } from "./run.ts";
import { saveAutomaton } from "./service.ts";
import { ensureExtensionDirs, livePath } from "../extensions/paths.ts";
import type { ScopeId } from "../scope/paths.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

// A minimal pi extension registering one uniquely-named tool, so its presence in the
// session's active tool names is unambiguous.
async function writeExt(
  scope: ScopeId,
  name: string,
  tool: string,
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(
    livePath(scope, name),
    `export default (pi) => {
  pi.registerTool({
    name: ${JSON.stringify(tool)},
    description: "spike",
    parameters: { type: "object", properties: {} },
    execute: () => ({ content: [{ type: "text", text: "ok" }], details: null }),
  });
};
`,
  );
}

Deno.test("an automaton loads exactly the extensions it names", async () => {
  await withTempHome(async () => {
    await writeExt("ws-1", "named_ext", "spike_named");
    await writeExt("ws-1", "unnamed_ext", "spike_unnamed");
    await saveAutomaton("ws-1", "probe", {
      description: "",
      prompt: "noop",
      extensions: ["named_ext"],
      skills: [],
    });
    // A template for `prompt:` to resolve. The run is stopped before it can send.
    await Deno.mkdir(
      `${Deno.env.get("HOME")}/.pique/scopes/ws-1/agent/prompts`,
      {
        recursive: true,
      },
    );
    await Deno.writeTextFile(
      `${Deno.env.get("HOME")}/.pique/scopes/ws-1/agent/prompts/noop.md`,
      "---\ndescription: noop\n---\nsay nothing\n",
    );

    const id = await launchAutomaton({
      scope: "ws-1",
      name: "probe",
      cwd: Deno.cwd(),
      trigger: "test",
    });
    try {
      const names = activeToolNamesOfRun(id);
      // The named extension's tool is present…
      assertEquals(names.includes("spike_named"), true);
      // …and the one enabled in the same scope but NOT named is absent. This single
      // assertion is what proves noExtensions composes rather than filters.
      assertEquals(names.includes("spike_unnamed"), false);
    } finally {
      await stopRun(id);
    }
  });
});
```

- [ ] **Step 2: Add the accessor the test needs**

The test calls `activeToolNamesOfRun`, which does not exist yet. Add it to
`src/lib/automatons/run.ts`, beside `runHistory`:

```ts
// Names of the tools this run can actually call: pi's builtins, the customTools its
// `pique:` groups contributed, and the tools registered by the extensions it named.
// The counterpart of chat's activeToolNames, and what run_integration_test.ts asserts
// the capability set through.
export function activeToolNamesOfRun(id: string): string[] {
  return runs.get(id)?.session.getActiveToolNames() ?? [];
}
```

Add it to the import list at the top of `run_integration_test.ts`:

```ts
import { activeToolNamesOfRun, launchAutomaton, stopRun } from "./run.ts";
```

- [ ] **Step 3: Run it**

Run: `deno test -A src/lib/automatons/run_integration_test.ts` Expected: PASS.

This test needs a model to be reachable, exactly as
`chat/scope_integration_test.ts` does. If it fails at `model unavailable`, run
the existing chat integration test first — if that also fails, the environment
has no configured provider and this is an environment problem, not a code one.
**Do not "fix" it by loosening the assertion.**

- [ ] **Step 4: Commit**

```bash
git add src/lib/automatons && git commit -m "Prove an automaton loads exactly the extensions it names"
```

---

### Task 7: Bindings and the desktop backend

**Files:** Create `src/lib/automatons/bindings.ts`,
`src/lib/skills/bindings.ts`; modify `src/desktop.ts`

- [ ] **Step 1: Write the frontend contracts**

Create `src/lib/skills/bindings.ts`:

```ts
// Frontend half of the skills binding contract. The backend half is the skills*
// win.bind handlers in src/desktop.ts (delegating to skills/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { SkillInfo } from "./service.ts";
export type { SkillInfo };

export interface SkillBindings {
  // Every skill nameable in this scope: its own plus inherited, nearest winning.
  skillsVisible(arg: { scope: string }): Promise<SkillInfo[]>;
}

// Null in web-dev (deno task web), where there's no desktop backend.
export function skillBindings(): SkillBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as SkillBindings) : null;
}
```

Create `src/lib/automatons/bindings.ts`:

```ts
// Frontend half of the automatons binding contract. The backend half is the
// automaton* win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by
// hand (separate module graphs).
import type { AutomatonInfo } from "./service.ts";
import type { RunRecord, RunStatus } from "./run.ts";
import type { ChatEvent, Item } from "../chat/agent.ts";
export type { AutomatonInfo, RunRecord, RunStatus };

// `automatonsList` is a scope's OWN definitions — the ones it can edit or delete.
// `automatonsVisible` is everything launchable there, inherited included.
export interface AutomatonBindings {
  automatonsList(arg: { scope: string }): Promise<AutomatonInfo[]>;
  automatonsVisible(arg: { scope: string }): Promise<AutomatonInfo[]>;
  automatonsSave(
    arg: {
      scope: string;
      name: string;
      description: string;
      prompt: string;
      extensions: string[];
      skills: string[];
    },
  ): Promise<unknown>;
  automatonsDelete(arg: { scope: string; name: string }): Promise<unknown>;
  automatonsLaunch(
    arg: { scope: string; name: string; args?: string; cwd?: string },
  ): Promise<{ id: string }>;
  automatonsRuns(arg: { scope: string }): Promise<RunRecord[]>;
  automatonsHistory(arg: { id: string }): Promise<Item[]>;
  automatonsRead(arg: { id: string }): Promise<ChatEvent[]>;
  automatonsStop(arg: { id: string }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the module then
// shows a desktop-only note, same as Chat and Terminal.
export function automatonBindings(): AutomatonBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as AutomatonBindings) : null;
}
```

- [ ] **Step 2: Wire the backend**

In `src/desktop.ts`, add two module declarations beside the existing ones (near
line 31, after `prompts`):

```ts
let automatons: typeof import("./lib/automatons/run.ts");
let automatonService: typeof import("./lib/automatons/service.ts");
let skills: typeof import("./lib/skills/service.ts");
```

Add the binds after the last `promptsDelete` bind and **before** the
`win.addEventListener("close", ...)` block:

```ts
// Automatons. `automatonsLaunch` resolves the module's working directory the way every
// other module does, so a run starts where the workspace points.
win.bind("automatonsList", async (arg) => {
  const { scope } = arg as { scope: string };
  return await automatonService.listAutomatons(scope);
});

win.bind("automatonsVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await automatonService.listVisibleAutomatons(scope);
});

win.bind("automatonsSave", async (arg) => {
  const { scope, name, description, prompt, extensions, skills: skillRefs } =
    arg as {
      scope: string;
      name: string;
      description: string;
      prompt: string;
      extensions: string[];
      skills: string[];
    };
  await automatonService.saveAutomaton(scope, name, {
    description,
    prompt,
    extensions,
    skills: skillRefs,
  });
  return true;
});

win.bind("automatonsDelete", async (arg) => {
  const { scope, name } = arg as { scope: string; name: string };
  await automatonService.deleteAutomaton(scope, name);
  return true;
});

win.bind("automatonsLaunch", async (arg) => {
  const { scope, name, args, cwd: override } = arg as {
    scope: string;
    name: string;
    args?: string;
    cwd?: string;
  };
  return {
    id: await automatons.launchAutomaton({
      scope,
      name,
      args,
      cwd: await moduleDir(override),
    }),
  };
});

win.bind("automatonsRuns", async (arg) => {
  const { scope } = arg as { scope: string };
  return await automatons.listRuns(scope);
});

win.bind("automatonsHistory", async (arg) => {
  const { id } = arg as { id: string };
  return automatons.runHistory(id);
});

win.bind("automatonsRead", async (arg) => {
  const { id } = arg as { id: string };
  return await automatons.readRun(id);
});

win.bind("automatonsStop", async (arg) => {
  const { id } = arg as { id: string };
  await automatons.stopRun(id);
  return true;
});

win.bind("skillsVisible", async (arg) => {
  const { scope } = arg as { scope: string };
  return await skills.listVisibleSkills(scope);
});
```

Add the imports beside the existing ones, after `prompts = await import(...)`:

```ts
automatons = await import("./lib/automatons/run.ts");
automatonService = await import("./lib/automatons/service.ts");
skills = await import("./lib/skills/service.ts");
```

Finally, after the `migrateToScopes()` line, add the startup repair:

```ts
// A run lives in this process's memory, so every `running` record on disk belongs to a
// process that is gone. Turn those into `failed` before anything lists them.
await automatons.reconcileRuns();
```

**The file's first constraint still holds: every bind must be registered before
the first top-level `await`.** The three new `await import`s and
`reconcileRuns()` all go in the tail section, below the binds — do not hoist
them, and do not reshuffle the existing binds while you are in there.

- [ ] **Step 3: Verify**

Run: `deno check src/desktop.ts` Expected: clean.

Run: `deno task build` Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/desktop.ts src/lib/automatons src/lib/skills
git commit -m "Wire automaton and skill bindings"
```

---

### Task 8: The Automatons module

**Files:** Create `src/lib/automatons/Automatons.svelte`; modify
`src/lib/modules/registry.ts`, `src/lib/layout_test.ts`

Read `src/lib/library/Library.svelte` first for the scope-derivation idiom and
`src/lib/prompts/Prompts.svelte` for the list/editor/error idiom this follows.

- [ ] **Step 1: Pin the label**

In `src/lib/layout_test.ts`, beside the existing `moduleLabel` cases, add:

```ts
Deno.test("automatons gets a capitalized label from the fallback", () => {
  assertEquals(moduleLabel("automatons"), "Automatons");
});
```

- [ ] **Step 2: Run it**

Run: `deno test -A src/lib/layout_test.ts` Expected: PASS — `moduleLabel`'s
capitalize fallback already yields this, so no `LABELS` entry is needed. The
test exists to pin it against a future edit.

- [ ] **Step 3: Build the module**

Create `src/lib/automatons/Automatons.svelte`. Two panes: the automatons visible
in scope with their runs on the left, and either a run transcript or the form
editor on the right.

```svelte
<script lang="ts">
  import { ROOT } from "../scope/paths.ts";
  import { automatonBindings, type AutomatonInfo, type RunRecord } from "./bindings.ts";
  import { skillBindings, type SkillInfo } from "../skills/bindings.ts";
  import { extensionBindings } from "../extensions/bindings.ts";
  import { promptBindings, type PromptInfo } from "../prompts/bindings.ts";
  import type { Item } from "../chat/agent.ts";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  // Same shape as Library and Kanban: the module owns its scope, so two tabs in two
  // workspaces cannot fight over one store. `workspaceId` is optional only because
  // Column threads it through as optional; root's id IS `ROOT`.
  const workspace = $derived(workspaceId ?? ROOT);
  const isRootWorkspace = $derived(workspace === ROOT);
  let showRoot = $state(false);
  const scope = $derived(showRoot ? ROOT : workspace);

  const api = automatonBindings();

  let automatons = $state<AutomatonInfo[]>([]);
  let runs = $state<RunRecord[]>([]);
  let selected = $state<{ kind: "run"; id: string } | { kind: "edit"; name?: string } | null>(null);
  let transcript = $state<Item[]>([]);
  let error = $state("");
  let launchArgs = $state<Record<string, string>>({});

  // Pickers for the editor. Every field is a choice from a list, which is why this is a
  // form and not a textarea: an automaton's content is references, and a typo in one
  // becomes a launch failure by design (resolve.ts).
  let prompts = $state<PromptInfo[]>([]);
  let skills = $state<SkillInfo[]>([]);
  let extensionNames = $state<string[]>([]);
  const BUILTIN_REFS = ["pique:kanban", "pique:extension-authoring", "pique:prompt-authoring"];

  async function refresh() {
    if (!api) return;
    try {
      [automatons, runs] = await Promise.all([
        api.automatonsVisible({ scope }),
        api.automatonsRuns({ scope }),
      ]);
      error = "";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function refreshPickers() {
    const skillApi = skillBindings();
    const extApi = extensionBindings();
    const promptApi = promptBindings();
    if (!skillApi || !extApi || !promptApi) return;
    skills = await skillApi.skillsVisible({ scope });
    prompts = await promptApi.promptsList({ scope });
    // Only enabled extensions are nameable — resolve.ts rejects pending ones, so
    // offering them here would build a definition that cannot launch.
    const exts = await extApi.extensionsVisible({ scope });
    extensionNames = exts.filter((e) => e.state === "enabled").map((e) =>
      e.origin === "package" ? (e.source ?? e.name) : e.name
    );
  }

  $effect(() => {
    scope;
    refresh();
    refreshPickers();
  });

  async function launch(name: string) {
    if (!api) return;
    try {
      const { id } = await api.automatonsLaunch({ scope, name, args: launchArgs[name] || undefined });
      selected = { kind: "run", id };
      await refresh();
      drain(id);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await refresh();
    }
  }

  // Long-poll drain, the same shape chat's store uses: re-poll until the run stops
  // producing events, refreshing the record so the row's status follows.
  async function drain(id: string) {
    if (!api) return;
    for (;;) {
      const events = await api.automatonsRead({ id });
      if (selected?.kind !== "run" || selected.id !== id) return;
      if (!events.length) {
        await refresh();
        const record = runs.find((r) => r.id === id);
        if (record && record.status !== "running") return;
        continue;
      }
      transcript = await api.automatonsHistory({ id });
      await refresh();
    }
  }

  async function openRun(id: string) {
    if (!api) return;
    selected = { kind: "run", id };
    transcript = await api.automatonsHistory({ id });
    const record = runs.find((r) => r.id === id);
    if (record?.status === "running") drain(id);
  }

  async function stop(id: string) {
    await api?.automatonsStop({ id });
    await refresh();
  }

  const runsOf = (name: string) => runs.filter((r) => r.automaton === name).slice(0, 5);
</script>

{#if !api}
  <div class="p-4 text-sm opacity-60">Automatons need the desktop app.</div>
{:else}
  <div class="flex h-full min-h-0">
    <div class="flex w-80 shrink-0 flex-col border-r border-base-300">
      <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-3 py-1.5">
        {#if !isRootWorkspace}
          <button class="btn btn-ghost btn-xs" class:btn-active={!showRoot} onclick={() => (showRoot = false)}>Workspace</button>
          <button class="btn btn-ghost btn-xs" class:btn-active={showRoot} onclick={() => (showRoot = true)}>Root</button>
        {/if}
        <button class="btn btn-ghost btn-xs ml-auto" onclick={() => (selected = { kind: "edit" })}>+ New</button>
        <button class="btn btn-ghost btn-xs" aria-label="Refresh" onclick={refresh}>↻</button>
      </div>

      {#if error}<div class="px-3 py-2 text-xs text-error">{error}</div>{/if}

      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each automatons as a (a.name)}
          <div class="border-b border-base-300 px-3 py-2">
            <div class="flex items-center gap-2">
              <button class="link text-sm font-semibold" onclick={() => (selected = { kind: "edit", name: a.name })}>{a.name}</button>
              {#if a.scope !== scope}<span class="badge badge-ghost badge-xs">inherited</span>{/if}
              <button class="btn btn-primary btn-xs ml-auto" disabled={!!a.error} onclick={() => launch(a.name)}>Launch</button>
            </div>
            {#if a.error}
              <div class="mt-1 text-xs text-error">{a.error}</div>
            {:else}
              <div class="mt-0.5 text-xs opacity-60">{a.description || `/${a.prompt}`}</div>
            {/if}
            <input class="input input-xs mt-1 w-full" placeholder="arguments (optional)" bind:value={launchArgs[a.name]} />
            {#each runsOf(a.name) as run (run.id)}
              <div class="mt-1 flex items-center gap-2 text-xs">
                <button class="link opacity-70" onclick={() => openRun(run.id)}>{run.status}</button>
                <span class="opacity-50">{new Date(run.startedAt).toLocaleString()}</span>
                {#if run.status === "running"}
                  <button class="btn btn-ghost btn-xs ml-auto" onclick={() => stop(run.id)}>Stop</button>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="p-4 text-sm opacity-60">No automatons in this scope yet.</div>
        {/each}
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      {#if selected?.kind === "run"}
        {#each transcript as item, i (i)}
          <div class="mb-2 text-sm">
            <span class="badge badge-ghost badge-xs mr-2">{item.role}</span>
            <span class="whitespace-pre-wrap">{item.role === "tool" ? `${item.name} ${item.result}` : item.text}</span>
          </div>
        {:else}
          <div class="text-sm opacity-60">No output yet.</div>
        {/each}
      {:else if selected?.kind === "edit"}
        {@render editor()}
      {:else}
        <div class="text-sm opacity-60">Select an automaton to edit, or a run to read.</div>
      {/if}
    </div>
  </div>
{/if}
```

Add the editor snippet inside the same file, delegating to a form component:

```svelte
{#snippet editor()}
  {@const editing = selected?.kind === "edit" && selected.name
    ? automatons.find((a) => a.name === selected.name)
    : undefined}
  <AutomatonForm
    {scope}
    {editing}
    {prompts}
    {skills}
    {extensionNames}
    builtinRefs={BUILTIN_REFS}
    onsaved={async () => {
      selected = null;
      await refresh();
    }}
  />
{/snippet}
```

and import it at the top of the same `<script>`:

```ts
import AutomatonForm from "./AutomatonForm.svelte";
```

- [ ] **Step 4: Build the form**

The form lives in its own file so `Automatons.svelte` is not carrying both a
list with live-run polling and an editor. Create
`src/lib/automatons/AutomatonForm.svelte`:

```svelte
<script lang="ts">
  import { automatonBindings, type AutomatonInfo } from "./bindings.ts";
  import type { SkillInfo } from "../skills/bindings.ts";
  import type { PromptInfo } from "../prompts/bindings.ts";

  let {
    scope,
    editing,
    prompts,
    skills,
    extensionNames,
    builtinRefs,
    onsaved,
  }: {
    scope: string;
    editing?: AutomatonInfo;
    prompts: PromptInfo[];
    skills: SkillInfo[];
    extensionNames: string[];
    builtinRefs: string[];
    onsaved: () => void;
  } = $props();

  const api = automatonBindings();

  // Seeded once per edited automaton rather than kept in sync with the prop: this is a
  // draft the user is changing, and re-deriving it on every list refresh would discard
  // their edits mid-typing.
  let name = $state("");
  let description = $state("");
  let prompt = $state("");
  let picked = $state<string[]>([]);
  let pickedSkills = $state<string[]>([]);
  let error = $state("");

  let seeded: string | undefined;
  $effect(() => {
    const key = editing?.name ?? " new";
    if (seeded === key) return;
    seeded = key;
    name = editing?.name ?? "";
    description = editing?.description ?? "";
    prompt = editing?.prompt ?? "";
    picked = [...(editing?.extensions ?? [])];
    pickedSkills = [...(editing?.skills ?? [])];
    error = "";
  });

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function save() {
    if (!api) return;
    try {
      await api.automatonsSave({
        scope,
        name,
        description,
        prompt,
        extensions: picked,
        skills: pickedSkills,
      });
      onsaved();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="flex max-w-xl flex-col gap-3">
  <label class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wide opacity-60">Name</span>
    <input
      class="input input-sm"
      placeholder="daily-triage"
      disabled={!!editing}
      bind:value={name}
    />
    {#if !editing}
      <span class="text-xs opacity-50">Lowercase letters, digits and dashes.</span>
    {/if}
  </label>

  <label class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wide opacity-60">Description</span>
    <input class="input input-sm" bind:value={description} />
  </label>

  <label class="flex flex-col gap-1">
    <span class="text-xs font-semibold uppercase tracking-wide opacity-60">Prompt template</span>
    <select class="select select-sm" bind:value={prompt}>
      <option value="">— pick a template —</option>
      {#each prompts.filter((p) => p.state === "live") as p (p.name)}
        <option value={p.name}>{p.name}</option>
      {/each}
    </select>
    <span class="text-xs opacity-50">
      Sent as <code>/{prompt || "name"}</code> with the launch arguments appended.
    </span>
  </label>

  <fieldset class="flex flex-col gap-1">
    <legend class="text-xs font-semibold uppercase tracking-wide opacity-60">Extensions</legend>
    <!-- Nothing is implicit: a run loads exactly what is checked here and nothing else.
         This is not a sandbox — pi's builtins (read, write, edit, bash) are always
         present. See docs/automatons.md. -->
    {#each builtinRefs as ref (ref)}
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={picked.includes(ref)}
          onchange={() => (picked = toggle(picked, ref))}
        />
        <code>{ref}</code>
        <span class="text-xs opacity-50">built in</span>
      </label>
    {/each}
    {#each extensionNames as ref (ref)}
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={picked.includes(ref)}
          onchange={() => (picked = toggle(picked, ref))}
        />
        <code>{ref}</code>
      </label>
    {/each}
  </fieldset>

  <fieldset class="flex flex-col gap-1">
    <legend class="text-xs font-semibold uppercase tracking-wide opacity-60">Skills</legend>
    {#each skills as skill (skill.name)}
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="checkbox checkbox-xs"
          checked={pickedSkills.includes(skill.name)}
          onchange={() => (pickedSkills = toggle(pickedSkills, skill.name))}
        />
        <code>{skill.name}</code>
        <span class="text-xs opacity-50">{skill.description}</span>
      </label>
    {:else}
      <span class="text-xs opacity-50">No skills in this scope.</span>
    {/each}
  </fieldset>

  {#if error}<div class="text-xs text-error">{error}</div>{/if}

  <div>
    <button class="btn btn-primary btn-sm" disabled={!name || !prompt} onclick={save}>
      Save
    </button>
  </div>
</div>
```

Renaming is deliberately not offered — the filename is the name, so the field is
disabled when editing. Delete and recreate is the rename path, as it is for
prompt templates.

- [ ] **Step 5: Register the module**

In `src/lib/modules/registry.ts`, add the import beside the others and the entry
at the end of the record:

```ts
import Automatons from "../automatons/Automatons.svelte";
```

```ts
automatons: Automatons,
```

- [ ] **Step 6: Verify**

Run: `deno task build` Expected: clean.

Run: `deno task test` Expected: PASS, whole suite.

Then, web mode: `preview_start {name: "web"}` — Automatons appears in the `+`
menu, opening it gives a tab titled "Automatons", and it shows the desktop-only
note (as Chat and Terminal do).

- [ ] **Step 7: Commit**

```bash
git add src/lib/automatons src/lib/modules/registry.ts src/lib/layout_test.ts
git commit -m "Add the Automatons module"
```

---

### Task 9: The Library Skills sub-tab

**Files:** Create `src/lib/skills/Skills.svelte`; modify
`src/lib/library/Library.svelte`

Read-only, per design decision 12: skills get a listing, not a lifecycle.

- [ ] **Step 1: Build the section**

Create `src/lib/skills/Skills.svelte`, taking the same props the other two
sections take so the shell drives all three identically:

```svelte
<script lang="ts">
  import { skillBindings, type SkillInfo } from "./bindings.ts";

  let { scope, refreshKey }: { scope: string; scopeIsRoot: boolean; refreshKey: number } =
    $props();

  const api = skillBindings();
  let skills = $state<SkillInfo[]>([]);

  $effect(() => {
    scope;
    refreshKey;
    if (api) api.skillsVisible({ scope }).then((s) => (skills = s));
  });
</script>

{#if !api}
  <div class="p-4 text-sm opacity-60">Skills need the desktop app.</div>
{:else}
  <div class="p-3">
    <p class="mb-2 text-xs opacity-60">
      Skills a chat agent can use and an automaton can name. Read-only — add one by
      putting a directory or <code>.md</code> file in this scope's
      <code>agent/skills/</code>.
    </p>
    {#each skills as skill (skill.name)}
      <div class="border-b border-base-300 py-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">{skill.name}</span>
          {#if skill.scope !== scope}<span class="badge badge-ghost badge-xs">inherited</span>{/if}
        </div>
        <div class="text-xs opacity-60">{skill.description}</div>
        {#if skill.frontmatterName && skill.frontmatterName !== skill.name}
          <!-- Named by basename, never by frontmatter (skills/service.ts). Surfaced so
               the divergence is visible rather than a mystery at launch time. -->
          <div class="text-xs opacity-50">
            frontmatter name is <code>{skill.frontmatterName}</code>; name it
            <code>{skill.name}</code>
          </div>
        {/if}
      </div>
    {:else}
      <div class="text-sm opacity-60">No skills in this scope.</div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 2: Add the sub-tab**

In `src/lib/library/Library.svelte`: import `Skills`, widen the section state to
`"extensions" | "prompts" | "skills"`, add the third button beside Prompts, and
add the third pane below the other two, following the existing `class:hidden`
idiom exactly:

```svelte
<div class="min-h-0 flex-1 overflow-y-auto" class:hidden={section !== "skills"}>
  <Skills {scope} {scopeIsRoot} {refreshKey} />
</div>
```

- [ ] **Step 3: Verify**

Run: `deno task build` Expected: clean.

Web mode: Library now shows three sub-tabs and switching between them works.

- [ ] **Step 4: Commit**

```bash
git add src/lib/skills src/lib/library/Library.svelte
git commit -m "Add a read-only Skills sub-tab to Library"
```

---

### Task 10: Docs

**Files:** Create `docs/automatons.md`; modify `docs/scopes.md`, `README.md`

- [ ] **Step 1: `docs/automatons.md`**

Write the feature doc in the shape of `docs/prompts.md`. It must cover:

- What an automaton is, and the file format with a worked example.
- **That `prompt:` is what runs and the body is reserved** — the single most
  likely thing for a user to get wrong.
- The three ref shapes, including the `pique:` groups by name.
- **That the capability set is not a sandbox**: `noExtensions`/`noSkills` govern
  extension- and skill-provided capability only, and pi's builtins (`read`,
  `write`, `edit`, `bash`) are present in every run. Cross-reference
  [extensions.md](../extensions.md) deferred #1. Do not use the words "sandbox"
  or "restricted" for what this does.
- That an unresolvable reference fails the launch, and why that is deliberate.
- That naming a package also brings the skills that package ships.
- That runs do not survive quitting pique, and what `reconcileRuns` does.
- Deferred: triggers, `define_automaton`, caps, per-automaton model.

- [ ] **Step 2: `docs/scopes.md`**

Add two rows to the inheritance table: **Automatons**
(`scopes/<id>/automatons/*.md`, `automatons/service.ts`, nearest name wins) and
**Skills** (`scopes/<id>/agent/skills/`, `skills/service.ts`, nearest name
wins). Add a short section covering that automatons inherit but their _runs_
always belong to the launching scope, and that packages are still not inherited
— which is why an automaton naming one must be launched from the scope that
enabled it.

- [ ] **Step 3: `README.md`**

Add to the Modules list:

```markdown
- Automatons: Named agents — one prompt template plus the extensions and skills
  they may load — launched by a button and, later, by a card move or a schedule.
```

Add to Agent Structure, after the Skill line:

```markdown
- Automaton: A prompt template plus the exact extension and skill set a run may
  load, launched without a conversation — see
  [docs/automatons.md](docs/automatons.md).
```

**Do not fix** the System Prompt line above it while you are there, even though
it is wrong — it names `~/.pique/SYSTEM.md`, while the code has used
`~/.pique/scopes/<id>/agent/SYSTEM.md` since scopes landed. Pre-existing,
unrelated, and worth its own commit.

- [ ] **Step 4: Commit**

```bash
git add docs README.md && git commit -m "Document automatons"
```

---

### Task 11: Full verification

- [ ] `deno task test` — whole suite green.
- [ ] `deno task build` — clean.
- [ ] `deno fmt src/lib/automatons src/lib/skills docs/automatons.md` — the repo
      is not globally `deno fmt` clean (recorded in the collapse-profiles plan),
      so format only what this work added rather than burying the change.
- [ ] `deno check src/desktop.ts` — clean.
- [ ] Manual, **web mode** (`preview_start {name: "web"}`): Automatons is in the
      `+` menu, its tab is titled "Automatons", it shows the desktop-only note,
      and Library has three sub-tabs. Console clean.
- [ ] Manual, **desktop** (`deno task dev`) — the only surface where runs work:
  - Create an automaton in the form naming one enabled extension and one skill;
    confirm the file appears at `~/.pique/scopes/<id>/automatons/<name>.md` with
    the frontmatter the form showed.
  - Launch it. The run row goes `running` → `done`, and its transcript opens.
  - Edit the file by hand to name a nonexistent extension, then launch: the run
    is recorded `failed` with that extension named in the error, and **no
    session starts**.
  - Launch a long one and press Stop; the record becomes `stopped`.
  - Launch one and quit pique mid-run; reopen and confirm the record now reads
    `failed` / "interrupted by shutdown".
  - Confirm a root automaton is launchable from a workspace and marked
    `inherited`.

---

## Deferred

Carried from the design doc; do not build these here.

1. **Kanban-move and cron triggers.** Both are callers of `launchAutomaton`.
   Neither has a re-entrancy decision yet — whether a card moved twice launches
   twice, and whether a schedule fires while the previous run is still going.
2. **`define_automaton`.** `pending/` is created for it and nothing writes
   there.
3. **Restricting pi's builtins.** `session.setActiveToolsByName()` is the
   mechanism; see `docs/extensions.md` deferred #1.
4. **Per-automaton model, thinking level and base prompt.**
5. **Runs that outlive the app.**
6. **Turn and wall-clock caps.**
7. **A skill lifecycle** — install, review, quarantine.
8. **Concurrency limits.** Nothing stops ten simultaneous runs sharing one
   `ModelRuntime`.
