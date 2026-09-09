# User Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installed extension can contribute a right-pane module — a rail
row, a tab, and a panel of its own HTML — that reaches pique's data only through
a capability-checked broker, and cannot reach the `-A` process or the network at
all.

**Architecture:** The module's HTML runs in an iframe with
`sandbox="allow-scripts"`, served from a second loopback port under a
`default-src 'none'` CSP. It talks to the host over a `MessageChannel` port the
host hands it; the host relays to one `moduleCall` bind, holding the `moduleId`
and scope itself so a frame cannot address another module's data. The module
table (`MODULES`) stops being a `const` and becomes a merged runtime value.

**Tech Stack:** Deno 2, Svelte 5 (runes: `$state`, `$derived`, `$props`,
`$effect`), Tailwind 4 + daisyUI 5 (host side only — never inside the frame),
`@std/assert` for tests.

**Spec:**
[2026-09-02-user-modules-design.md](../specs/2026-09-02-user-modules-design.md)
— read it first. Its "The frame, measured" section is the evidence for the four
constraints this plan treats as non-negotiable, and every one of them is a thing
that silently does the wrong thing if ignored.

**Status:** The spec is Proposed, not accepted. This plan is what building it
would take; writing it is not a decision to build it.

---

## Orientation

Read these before starting. Phase 1 changes the first three; the rest you only
need to understand.

| File                            | Why                                                                      |
| ------------------------------- | ------------------------------------------------------------------------ |
| `src/lib/modules/manifest.ts`   | The table that becomes runtime in Task 1; read its header comment first  |
| `src/lib/modules/registry.ts`   | Kind → component; gains one entry in Task 2                              |
| `src/lib/Column.svelte`         | Line 89 renders `registry[tab.kind]`, line 96 is the unknown-kind branch |
| `src/lib/layout.ts`             | `moduleLabel`, `addTab`, `railGroups` — the reducers reading the table   |
| `src/lib/ModuleRail.svelte`     | Calls `railGroups()`; the rows a user module joins                       |
| `src/App.svelte`                | Line 277, the `ctrl+t` chord — deliberately NOT extended (decision 9)    |
| `src/desktop.ts`                | Head comment: binds before the first `await`; serve order matters        |
| `src/lib/extensions/service.ts` | `listVisibleLocal`, the enable/revoke lifecycle a module inherits        |
| `src/lib/extensions/paths.ts`   | The id regex a module id is held to                                      |
| `src/lib/scope/paths.ts`        | `ROOT`, `ScopeId`, `chain`, `scopeAgentDir`                              |

**Facts you will need, so you do not have to go looking:**

- `MODULES` entries are `{ kind, label, key, duplicable? }`. `EDITOR` is a bare
  id with no entry — `moduleLabel` capitalises it.
- `isDuplicable` answers `false` for an unknown kind, on purpose, and
  `Column.svelte` renders "Unknown module" for one. Both are the existing
  handling for a layout naming a kind this build does not have, and both must
  keep working — they are what makes an uninstalled, revoked, or wrong-scope
  module degrade instead of break. `layout_test.ts` is their regression net.
- A frame's origin is **opaque**. It cannot `fetch` even the server that served
  it, and `'self'` in a CSP matches nothing for it. A module is therefore ONE
  HTML document with its script and style inlined.
- Binds must be registered before the first top-level `await` in `desktop.ts`.
- The window navigates to the **first** `Deno.serve`. The frontend's server must
  stay first; the module server starts after it.
- Binding values must be JSON. No `Uint8Array` returns.
- `deno task test` is `deno test -A src/`. Test style:
  `Deno.test("a sentence describing the behaviour", () => { ... })`.
- `deno lint` reports **40** pre-existing problems (measured 2026-09-02, at
  `56c6a62`). Not a gate; the count must not grow. An earlier draft of this plan
  said ~30, carried over from an older plan — 40 is the real baseline.
- In web mode (`deno task web`) there is no `globalThis.bindings`. A user module
  must show the desktop-only placeholder, as Terminal and Chat do.

---

## File Structure

| File                                      | Change | Responsibility                                        |
| ----------------------------------------- | ------ | ----------------------------------------------------- |
| `src/lib/modules/manifest.ts`             | Edit   | Merged table: built-ins + installed                   |
| `src/lib/modules/manifest_test.ts`        | Create | Merge, precedence, reset                              |
| `src/lib/modules/registry.ts`             | Edit   | One entry for the frame host                          |
| `src/lib/modules/UserModule.svelte`       | Create | The iframe host and port handshake                    |
| `src/lib/modules/contract.ts`             | Create | RPC message shapes, shared host ↔ frame               |
| `src/lib/modules/capabilities.ts`         | Create | Pure: does this manifest permit this call?            |
| `src/lib/modules/capabilities_test.ts`    | Create | Every negative case                                   |
| `src/lib/modules/definition.ts`           | Create | Pure: parse and validate `module.json`                |
| `src/lib/modules/definition_test.ts`      | Create | Malformed, hostile and missing fields                 |
| `src/lib/modules/broker.ts`               | Create | Deno-side dispatch behind the capability check        |
| `src/lib/modules/broker_test.ts`          | Create | Dispatch, refusal, scope binding                      |
| `src/lib/modules/server.ts`               | Create | The module file server and its CSP header             |
| `src/lib/modules/server_test.ts`          | Create | Header contents, path anchoring                       |
| `src/lib/modules/service.ts`              | Create | Deno-side: list installed modules for a scope         |
| `src/lib/modules/service_test.ts`         | Create | Discovery, inheritance, a module.json that is junk    |
| `src/desktop.ts`                          | Edit   | Three binds, one extra `Deno.serve` (after the first) |
| `src/lib/library/items.ts`                | Edit   | A module row's badge                                  |
| `src/lib/extensions/ModuleConsent.svelte` | Create | The capability screen shown before enabling           |
| `docs/modules.md`                         | Create | The authoring doc                                     |
| `docs/security.md`                        | Edit   | The frame as a new boundary; what it does not hold    |
| `docs/extensions.md`                      | Edit   | `module:` as a second thing an extension contributes  |

---

## Phase 1 — the module table becomes runtime

No user code runs yet. This phase is independently valuable and independently
verifiable: at the end, everything behaves exactly as it does today, but the
table can hold entries that did not come from source.

### Task 1: `moduleDefs` merges built-ins with installed modules

**Files:** `src/lib/modules/manifest.ts`, `src/lib/modules/manifest_test.ts`

The existing exports (`moduleDef`, `railGroups`, `isDuplicable`, `hasTabs`) keep
their signatures and their call sites; they start reading a merged table instead
of the `MODULES` array directly. The installed half is set once at boot by a
module-level setter rather than threaded through every caller — the reducers in
`layout.ts` and the four components that call these functions take no scope
argument today, and giving them one would touch far more than this change needs.
The setter is what tests reset.

- [x] **Step 1: Write the tests**

Create `src/lib/modules/manifest_test.ts`:

```ts
import { assertEquals } from "@std/assert";
import {
  isDuplicable,
  moduleDef,
  MODULES,
  railGroups,
  setInstalledModules,
} from "./manifest.ts";

const def = (kind: string, label: string, duplicable = false) => ({
  kind,
  label,
  key: "",
  duplicable,
});

// Every test resets: the table is process-wide, and a leaked entry would make the
// next test pass or fail for a reason that is not in it.
function withInstalled(defs: ReturnType<typeof def>[], fn: () => void) {
  setInstalledModules(defs);
  try {
    fn();
  } finally {
    setInstalledModules([]);
  }
}

Deno.test("with nothing installed, the table is exactly the built-ins", () => {
  setInstalledModules([]);
  assertEquals(railGroups().length, MODULES.length + 1); // + the editor row
  assertEquals(moduleDef("kanban")?.label, "Kanban");
  assertEquals(moduleDef("notes"), undefined);
});

Deno.test("an installed module is a module in every respect", () => {
  withInstalled([def("notes", "Notes", true)], () => {
    assertEquals(moduleDef("notes")?.label, "Notes");
    assertEquals(isDuplicable("notes"), true);
    assertEquals(railGroups().includes("notes"), true);
  });
});

// A built-in must never be shadowed by an install: the kind decides which component
// renders, and letting an install win would let it replace Chat or Kanban.
Deno.test("a built-in kind wins a collision with an installed one", () => {
  withInstalled([def("kanban", "Not Kanban", true)], () => {
    assertEquals(moduleDef("kanban")?.label, "Kanban");
    assertEquals(isDuplicable("kanban"), false);
  });
});

Deno.test("installed modules come after the built-ins on the rail", () => {
  withInstalled([def("notes", "Notes")], () => {
    const groups = railGroups();
    assertEquals(groups[0], "editor");
    assertEquals(groups[groups.length - 1], "notes");
  });
});

// The chord is a fixed namespace (decision 9). An installed module carrying a `key`
// must not be reachable by it, or an install could shadow ctrl+t k.
Deno.test("installed modules contribute no chord letters", () => {
  withInstalled([{ kind: "notes", label: "Notes", key: "k" }], () => {
    assertEquals(MODULES.some((m) => m.kind === "notes"), false);
  });
});

Deno.test("an unknown kind stays a singleton", () => {
  setInstalledModules([]);
  assertEquals(isDuplicable("whatever"), false);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `deno test -A src/lib/modules/manifest_test.ts` Expected: FAIL — no export
named `setInstalledModules`.

- [x] **Step 3: Write the implementation**

In `src/lib/modules/manifest.ts`, keep `MODULES` exactly as it is — it stays the
built-in table and the chord's only source — and add:

```ts
// Modules contributed by installed extensions, set once at boot and on refresh
// (decision 10). Separate from MODULES rather than merged into it because the
// ctrl+t chord reads MODULES and must not see an install: a letter is a fixed
// namespace, and an install claiming one could shadow a built-in.
let installed: ModuleDef[] = [];

export function setInstalledModules(defs: ModuleDef[]): void {
  // A built-in always wins: `kind` decides which component renders, so a shadowing
  // entry would let an install replace Chat or Kanban.
  installed = defs.filter((d) => !MODULES.some((m) => m.kind === d.kind));
}

function allModules(): ModuleDef[] {
  return [...MODULES, ...installed];
}
```

Then change `moduleDef` and `railGroups` to read `allModules()`. `isDuplicable`
and `hasTabs` already go through `moduleDef`, so they follow for free.

- [x] **Step 4: Verify**

Run: `deno task test`. Expected: the new file passes and `layout_test.ts`,
`session_test.ts` and `workspace_test.ts` are untouched and still green — they
are the proof that the merged table is invisible when nothing is installed.

### Task 2: the registry falls through to the frame host

**Files:** `src/lib/modules/registry.ts`

- [x] **Step 1:** Add `UserModule` to the registry under a reserved kind, and
      export a `componentFor(kind)` that returns the built-in component when
      there is one and `UserModule` when the kind is an installed module.
      `Column.svelte` calls `componentFor(tab.kind)` instead of indexing
      `registry` directly; its "Unknown module" branch stays, and is what a kind
      that is neither built-in nor installed still falls to.

- [x] **Step 2: Verify** `deno task test`, then `deno task build` — the bundle
      must still build with no `@std/*` import reaching a frontend module (see
      the frontend-bundle constraint; `registry.ts` is bundled).

### Task 3: manual checkpoint

- [x] **Step 1:** `deno task dev`. With nothing installed, the rail, the `+`
      picker, `ctrl+t` and every module behave exactly as before. This is the
      whole acceptance criterion for Phase 1: a refactor nobody can see.

---

## Phase 2 — the frame

### Task 4: the module file server

**Files:** `src/lib/modules/server.ts`, `src/lib/modules/server_test.ts`

Serves exactly one file per module — `ui.html` from the module's own directory —
under the measured CSP. Nothing else is reachable, which makes the anchoring
question small: there is one filename, and the scope and module ids are the only
variables.

- [x] **Step 1: Write the tests**

```ts
import { assertEquals, assertThrows } from "@std/assert";
import { modulePolicy, uiPathFor } from "./server.ts";

// The header is the network control (spec: "Outbound requests"). If this string
// weakens, a module gets the network back and nothing else will notice.
Deno.test("the CSP grants inline script and style, and nothing else", () => {
  const p = modulePolicy();
  assertEquals(p.includes("default-src 'none'"), true);
  assertEquals(p.includes("script-src 'unsafe-inline'"), true);
  assertEquals(p.includes("style-src 'unsafe-inline'"), true);
  // 'self' matches nothing from an opaque origin and would only mislead a reader.
  assertEquals(p.includes("'self'"), false);
  assertEquals(p.includes("connect-src"), false); // default-src covers it
});

Deno.test("a ui path is built from a scope and module id", () => {
  assertEquals(
    uiPathFor("ws-1", "notes").endsWith(
      "/scopes/ws-1/agent/extensions/notes/ui.html",
    ),
    true,
  );
});

Deno.test("a bad scope or module id is refused, not resolved", () => {
  for (
    const [scope, id] of [["../root", "notes"], ["ws-1", "../../etc"], [
      "ws-1",
      "a/b",
    ]]
  ) {
    assertThrows(() => uiPathFor(scope, id));
  }
});
```

- [x] **Step 2:** Run it, watch it fail, then implement. `uiPathFor` reuses the
      id regexes from `scope/paths.ts` and `extensions/paths.ts` rather than
      inventing a third.

- [x] **Step 3:** In `desktop.ts`, start this server **after** the existing
      `Deno.serve`, and expose its port through the `moduleManifest` bind. Add a
      one-line comment saying why the order matters, next to the head comment's
      other silent-when-violated constraints.

### Task 5: the frame host

**Files:** `src/lib/modules/UserModule.svelte`, `src/lib/modules/contract.ts`

- [x] **Step 1:** `contract.ts` — the message shapes, no logic:
      `{ t: "call", id, method, payload }` / `{ t: "result", id, ok, value }` /
      `{ t: "event", topic, payload }`. Shared by host and SDK so neither
      drifts.

- [x] **Step 2:** `UserModule.svelte` renders
      `<iframe sandbox="allow-scripts" src={...ui.html}>` and on its `load`
      event posts a `MessageChannel` port to it. Every message on that port
      becomes a `bindings.moduleCall({ moduleId, scope, method, payload })` —
      **the component supplies `moduleId` and `scope` from its own props; it
      never reads them from the frame**, which is what makes a forged id
      impossible rather than merely detected.

- [x] **Step 3:** In web mode (`bindings` absent) render the same desktop-only
      placeholder Terminal and Chat use. No iframe at all.

- [x] **Step 4: Verify** `deno task web` — a fixture module's tab shows the
      placeholder and no console errors.

### Task 6: end-to-end with a fixture

- [x] **Step 1:** Hand-write `~/.pique/scopes/root/agent/extensions/notes/` with
      a `module.json` and a `ui.html` that renders one line and calls one
      capability. Boot with `deno task dev`, add the module to the installed
      table by hand (the Library wiring is Phase 4), open it from the `+`
      picker.

- [x] **Step 2:** Confirm in the running app: the panel renders, the port
      handshake completes, and the module's own `<script src>` — add one
      deliberately — does **not** load. That last one is the CSP working; if it
      loads, the header is not being applied and Phase 3 is unsafe to start.

---

## Phase 3 — the broker

### Task 7: the capability matcher

**Files:** `src/lib/modules/capabilities.ts`,
`src/lib/modules/capabilities_test.ts`

Pure, no Deno APIs, so the negative cases are cheap to cover exhaustively. This
is the file a reviewer should be able to read in one sitting.

- [x] **Step 1: Write the tests**

```ts
import { assertEquals } from "@std/assert";
import { allows, type Manifest } from "./capabilities.ts";

const m = (caps: Manifest["capabilities"]): Manifest => ({
  kind: "notes",
  label: "Notes",
  capabilities: caps,
});

Deno.test("a granted method is allowed", () => {
  assertEquals(allows(m({ kanban: true }), "kanbanGetBoard", {}), true);
});

Deno.test("an ungranted method is refused", () => {
  assertEquals(allows(m({ kanban: true }), "fsRead", { path: "/x" }), false);
});

// The list is a closed set. A method nobody granted — including one added to the
// broker later and forgotten here — must be refused by default.
Deno.test("an unknown method is refused even with every capability granted", () => {
  const all = m({
    kanban: true,
    storage: true,
    agent: true,
    fs: { read: ["/**"] },
  });
  assertEquals(allows(all, "termStart", {}), false);
  assertEquals(allows(all, "chatPrompt", {}), false);
});

Deno.test("fs.read is bounded by its declared roots", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  assertEquals(allows(notes, "fsRead", { path: "/home/u/notes/a.md" }), true);
  assertEquals(allows(notes, "fsRead", { path: "/home/u/secrets" }), false);
});

// The traversal case, spelled out because it is the one an attacker reaches for.
Deno.test("a traversal out of a declared root is refused", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  for (
    const p of [
      "/home/u/notes/../secrets",
      "/home/u/notes/../../etc/passwd",
      "/home/u/notes/./../x",
    ]
  ) {
    assertEquals(allows(notes, "fsRead", { path: p }), false, p);
  }
});

// A prefix is not a parent: /home/u/notes-private is not inside /home/u/notes.
Deno.test("a sibling sharing a name prefix is not inside the root", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  assertEquals(
    allows(notes, "fsRead", { path: "/home/u/notes-private/x" }),
    false,
  );
});

Deno.test("read does not imply write", () => {
  const notes = m({ fs: { read: ["/home/u/notes"] } });
  assertEquals(allows(notes, "fsWrite", { path: "/home/u/notes/a.md" }), false);
});

Deno.test("an empty manifest permits nothing", () => {
  assertEquals(allows(m({}), "kanbanGetBoard", {}), false);
});
```

- [x] **Step 2:** Run, fail, implement. Normalise with `@std/path`'s `resolve`
      before comparing, and compare on segment boundaries so the prefix test
      passes.

### Task 8: the binds

**Files:** `src/desktop.ts`, `src/lib/modules/broker.ts`, `broker_test.ts`

- [x] **Step 1:** `broker.ts` — `dispatch(moduleId, scope, method, payload)`
      calls `allows()` first and throws a refusal that names the method and the
      capability it would have needed. Tests cover: a granted call reaches its
      handler; a refused one never does (assert with a handler that records
      calls); the scope the handler receives is the one passed in, never one
      from the payload.

- [x] **Step 2:** In `desktop.ts`, before the first `await`, bind
      `moduleManifest` (installed modules for a scope, plus the module server
      port), `moduleCall` and `moduleEvents` (a bounded long-poll, copying
      `termRead`'s 20s shape at line 77). Each handler resolves the module's
      manifest for the scope it was given and passes it to `dispatch`.

- [x] **Step 3: Verify** `deno task test`, then `deno task dev` with the
      fixture: a granted call returns data, a call the fixture is not granted
      returns a refusal the panel can display.

### Task 9: the adversarial fixture

- [x] **Step 1:** Add a fixture module that attempts, in one page:
      `parent.bindings`, `top.location`, `parent.document`, `localStorage`, a
      `moduleCall` outside its manifest, a `../` escape from its `fs.read` root,
      another module's id, and an outbound beacon via `new Image().src`.

- [x] **Step 2:** Run it under `deno task dev` and record the result of each in
      `docs/modules.md`. Assert on the `DOMException`, never on
      `location.origin` — WebKit reports the URL origin for a served frame while
      still enforcing opacity, so an origin assertion passes for the wrong
      reason.

---

## Phase 4 — manifest and Library

> **Reordered during execution (2026-09-02).** Tasks 10 and 11 moved into Phase
> 3: the broker checks a call against a module's manifest, and there is no way
> to read one without `definition.ts` and `service.ts`. The phase boundary as
> written was wrong. Task 12 is what remains here.

### Task 10: `module.json`

**Files:** `src/lib/modules/definition.ts`, `definition_test.ts`

- [x] **Step 1: Write the tests.** Cover: a valid file parses; a missing `kind`
      or `label` is rejected; a `kind` that is not a legal id is rejected; a
      `kind` colliding with a built-in is rejected **at parse time** so it never
      reaches the table; an unknown capability name is rejected rather than
      ignored (a typo'd `fs.raed` must not silently grant nothing and look
      enabled); `capabilities` absent means an empty grant, not a full one.

- [x] **Step 2:** Run, fail, implement. Return a discriminated result
      (`{ ok: true, def }` / `{ ok: false, error }`) rather than throwing — a
      junk `module.json` in one extension must not break the listing of the
      others, exactly as a broken automaton is listed with its error today.

### Task 11: discovery

**Files:** `src/lib/modules/service.ts`, `service_test.ts`

- [x] **Step 1:** `listModules(scope)` walks the same `chain(scope)` the
      extension service walks, reads `module.json` from each **enabled**
      extension dir (never from `pending/`), and returns definitions plus their
      errors. Tests use a throwaway agent dir, mirroring
      `extensions/local_test.ts`.

- [x] **Step 2:** Wire it: on boot and on Library refresh, the frontend calls
      `moduleManifest` and passes the result to `setInstalledModules`.

### Task 12: the Library row and the consent screen

> **Grew during execution.** Task 12 as written assumed a consent screen could
> be bolted onto an existing gate. There was none: a `module.json` in the live
> dir ran with its capabilities and nothing asked. The gate had to be built —
> `pending/` for modules, `enableModule`, `revokeModule` — before a consent
> screen had anything to gate.

- [x] **Step 1:** A module-bearing extension gets a badge in its Library row.
      Its review already shows the extension's code; the consent screen adds
      what the module asks for, in the plain words of the capability table, and
      is shown **before** enable — the same position the code review already
      occupies.

- [x] **Step 2:** Revoking removes the module from the table on next refresh. An
      open tab of it falls to "Unknown module" rather than a broken frame. Add
      this to the manual test plan; it is the case the existing unknown-kind
      handling was written for, and it should need no new code.

---

## Phase 5 — documentation

### Task 13

- [ ] **Step 1:** `docs/modules.md` — the authoring doc. It must state the one
      inlined document constraint and _why_ (opaque origin, `'self'` matches
      nothing), the capability list, and the adversarial results from Task 9. An
      author who does not know why they cannot ship an `app.js` will file it as
      a bug.

- [ ] **Step 2:** `docs/security.md` — a new subsection for the frame: what it
      holds (measured), what it does not (the network without the CSP; the
      advisory gate, unchanged), and the fact that a module widens what the
      standing agent → filesystem finding touches.

- [ ] **Step 3:** `docs/extensions.md` — `module:` as a second thing an
      extension may contribute, in the same table as tools and skills.

---

## Verification

- **Unit:** `deno task test`. New coverage in `manifest_test.ts`,
  `capabilities_test.ts`, `definition_test.ts`, `broker_test.ts`,
  `server_test.ts`, `service_test.ts`. `layout_test.ts` must pass **unmodified**
  throughout — if a change to it seems necessary, the merged table has broken
  the unknown-kind contract and that is a bug in this work, not in the test.
- **Build:** `deno task build`. No `@std/*` import may reach a bundled frontend
  module.
- **Lint:** `deno lint` — the 40 pre-existing problems must not grow.
- **Web mode:** `deno task web` — a module tab shows the desktop-only
  placeholder, no console errors.
- **Desktop:** `deno task dev` — install → review → consent → enable → refresh →
  open → the panel reads its data; revoke → the open tab falls to "Unknown
  module"; a second workspace does not see the first's storage.
- **Adversarial:** Task 9's fixture, every probe failing closed.

## Deliberately not in this plan

Carried from the spec's Deferred section, listed here so nobody adds them
mid-task: a `ctrl+t` letter for user modules; hot-add into an open view; modules
in the center column or editor row; module updates; a network capability. The
last one is a CSP question, not a broker one — adding it means relaxing the
header per named host, and the consent screen naming those hosts.
