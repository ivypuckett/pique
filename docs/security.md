# Security

Where pique's trust boundaries actually are, what holds them, and — at the end —
what is known weak and what a review has already cleared. Audited 2026-08-15
against `285c17e`, desktop runtime only.

One fact governs everything here: pique ships as `deno desktop -A` (deno.json's
`dev` task). The backend holds full system authority, and every `win.bind`
handler in `src/desktop.ts` runs with it. Nothing below is defence in depth
behind a sandbox, because there is no sandbox — these are the only boundaries
there are.

## The two boundaries

**Webview → backend.** The frontend can call any `win.bind` handler with any
argument. Handlers are therefore treated as an untrusted entry point: every one
that names a file routes through an anchored validator before it touches disk.

**Agent → filesystem.** A chat agent runs with pi's builtins — `read`, `write`,
`edit`, `bash`, `grep` — in every session. It can write anywhere the user can.
This is the boundary that does not hold, and the rest of this document is mostly
about where that matters.

There is a third thing people mistake for a boundary. The webview has no address
bar and renders model output; if that output could inject HTML it would reach
every `win.bind` handler and the `-A` process behind them. Model output → XSS →
RCE is the shortest path to compromise in this app, which is why "no `{@html}`"
is a security property here and not a style preference. See
[Verified clean](#verified-clean).

## What the review gates do and do not do

| Surface         | Quarantine dir                 | Auto-discovered from live dir | Gated    |
| --------------- | ------------------------------ | ----------------------------- | -------- |
| Local extension | `agent/pending/`               | `agent/extensions/`           | advisory |
| Package         | `agent/pending/<slug>.json`    | `agent/settings.json`         | advisory |
| Prompt template | `agent/prompts/pending/`       | `agent/prompts/`              | advisory |
| Automaton       | `automatons/pending/` (unused) | `automatons/`                 | **none** |

"Advisory" is [extensions.md](extensions.md)'s own word, and it is the right
one: the gate governs what a human *moves* into the loading set, not what can
*appear* there. An agent holding `write` puts a file in the live dir directly.
The gate is still worth having — it is what makes the ordinary path reviewable,
and it is a real gate against a package you fetched — but it is not a control
against a misaligned agent, and no part of the UI should imply otherwise.

The automaton row is the one that is not merely advisory but absent, and it is
finding 1.

---

## Findings

### 1. Agent-written automatons are unattended recurring execution — HIGH

[extensions.md](extensions.md) Deferred #1 discloses that the extension gate is
advisory. The automaton path is not covered by that disclosure and is worse.

`automatons/paths.ts` reserves `automatons/pending/` but records that nothing
writes there until `define_automaton` exists. `service.ts:listAutomatons` reads
`automatonsDir(scope)` — the live dir — directly, and `startScheduler()`
(`desktop.ts:717`) fires what it finds there on the definition's `cron:`. There
is no digest, no approval step, and no quarantine even nominally.

So a chat agent with the default builtin set can:

1. write `~/.pique/scopes/root/agent/prompts/x.md` — the **live** prompt dir,
   which pi auto-discovers ([prompts.md](prompts.md)); approval only ever gated
   `pending/`;
2. write `~/.pique/scopes/root/automatons/x.md` with `prompt: x`,
   `cron: "* * * * *"`, and **no `tools:` key** — `excludedBuiltins(undefined)`
   returns `[]` (`resolve.ts:53`), which is every builtin including `bash`;
3. stop. The scheduler launches it every minute, unattended, across restarts.

No human clicks Enable anywhere in that chain. The extension bypass yields code
that runs the next time a session starts; this yields a job that runs forever.

It also survives the mitigation Deferred #1 proposes. That one blocks writes
resolving inside the scope's `agent/` dir — and `automatons/` is deliberately
outside `agent/`, so that pi does not interpret a directory of markdown
(`automatons/paths.ts`). The planned fix as written would not cover the worse
hole.

**Fix.** Make the two unattended triggers — `schedule.ts` and the kanban
dispatcher — launch only definitions recorded in a human-approved,
digest-keyed manifest, the way `enableExtension` already works. A dropped-in
`.md` stays listable and stays launchable by the button; it never self-fires. If
the `tool_call` interception of Deferred #1 is built, its path set must include
`~/.pique/scopes/*/automatons/` and `agent/prompts/` as well as `agent/`.

### 2. The UI server binds to every interface on a fixed port — MEDIUM

```ts
Deno.serve((req) => serveDir(req, { fsRoot: "dist", quiet: true })); // desktop.ts:729
```

Deno's default is `0.0.0.0:8000`, so a desktop app publishes its UI to the whole
LAN for as long as it is open, on a port that is one of the most commonly
contended on a developer's machine.

The blast radius is bounded: `win.bind` is webview IPC and is not reachable over
HTTP, so a remote fetch returns static assets and nothing else, and `serveDir`
resists traversal and has directory listing off. This is an unexpected listening
service and asset disclosure, not remote code execution. There is still no
reason for it.

**Fix.** `Deno.serve({ hostname: "127.0.0.1" }, …)`. `port: 0` would also settle
the collision, but deno desktop auto-navigates the adopted window to the served
address (`desktop.ts` head comment) — confirm it reads the bound port before
relying on it.

### 3. Credentials are written with default file permissions — MEDIUM

`providers.ts:writeModelsJson` writes `~/.pi/agent/models.json` — which holds
`apiKey` for a custom provider, via `buildCustomEntry` — with
`Deno.writeTextFile` and no `mode`. That is `0o666 & ~umask`, so **0644** on a
stock machine: any other user on the host can read the key.
`settings/file.ts:writeJson` has the same shape for `~/.pique/*.json`, and the
`Deno.mkdir` calls beside both leave their directories 0755.

**Fix.** `{ mode: 0o600 }` on the credential write, `{ mode: 0o700 }` on the
mkdir. `auth.json` is written by pi itself and is upstream of pique; worth
confirming what it does rather than assuming.

Not fixable by a mode bit, and worth stating plainly next to the decision to
share those files with the `pi` CLI: the chat agent has `read` and its cwd is
usually `$HOME`, so it can read both files and send them anywhere. That is the
direct cost of "this is not a sandbox".

### 4. The digest gate is optional at the backend — LOW

`enableExtension(scope, id, expectDigest?)` verifies only when
`expectDigest !== undefined` (`extensions/service.ts:268`). The frontend always
supplies it — Enable is `disabled` until the row is expanded
(`Library.svelte:358`), and expanding is what runs `extensionsRead` — so this is
not bypassable from the UI today. But the property depends on every future
caller remembering an optional argument.

**Fix.** Make `expectDigest` required for the pending → enabled transition. The
neighbouring case is already fine: `reviewed` is not cleared when a row
collapses, but a stale digest fails closed, because a mismatch refuses.

### 5. The theme value validator does not block `url()` — LOW

`theme_css.ts:39` is `UNSAFE_VALUE_RE = /[{}@;<>]/`, and the comment above it
gives the intent as stopping a value that could "close our rule and open
something else — a `url()` that phones home, say". A value of
`url(https://example.invalid/beacon.png)` contains none of those characters and
parses.

Not currently exploitable: nothing in `app.css` or the components substitutes a
theme var into a url-accepting property — the only `var()` chain of that kind is
`GitDiff.svelte:145`, which is a color. It is worth closing anyway, because
`themes.json` is agent-writable and applied at boot, so the day a component uses
a var in `background`, `mask` or `content` this becomes a beacon that fires on
every launch.

**Fix.** Reject `url(` and `image-set(` in values.

### 6. Two comments claim more than the docs do — INFO

`extensions/agent-tools.ts:2` says written source "cannot execute until a human
reviews and enables it", and the `define_extension` description tells the model
the same thing. [extensions.md](extensions.md) Deferred #1 says the gate is
advisory. The doc is correct. Align the comment and the tool description, so
that nothing later gets built on the stronger claim.

---

## Verified clean

Recorded because the coverage is the point — a finding list alone does not say
what was looked at.

- **Path traversal.** Every filesystem path routes through an anchored
  validator: `assertScopeId`, `assertViewId`, `assertExtensionName`,
  `assertPromptName`, `assertSkillName`, `assertAutomatonName`, `runPath`, and
  `settings/file.ts`'s config `NAME_RE`. `fs.ts:parseEntryName` refuses absolute
  paths and `.` / `..` segments. `packageSlug` percent-encodes and then asserts
  that no separator survived. No traversal found on any `win.bind` path.
- **Command injection.** Every `Deno.Command` is an argv array with no shell:
  `git.ts`, `dialog.ts` (kdialog, zenity, xdg-open), and the PTY spawn in
  `terminal/pty.ts`. `openUrlCommand` is https-only and its one caller passes a
  compiled-in constant.
- **SQL injection.** `kanban/board.ts` is parameterized throughout; the single
  dynamic statement (`getLogs`) selects between two constant query strings.
- **HTML injection.** No `{@html}`, `innerHTML`, `eval` or `new Function`
  anywhere in `src/`. Svelte's auto-escaping is what keeps model output out of
  the binding surface (see [The two boundaries](#the-two-boundaries)); it is
  worth a lint rule pinning it. Theme CSS reaches the DOM as `textContent` on a
  `<style>` element, which does not parse HTML, and theme names and property
  names are regex-constrained.
- **Scope isolation.** `resolveBoardScope` resolves to the caller's own board or
  root's and has no way to name a sibling workspace's; `chain()` is the single
  encoding of the hierarchy ([scopes.md](scopes.md)).
- **Skill refs.** `resolveSkillPath` matches against a directory listing rather
  than concatenating the ref into a path, so a ref cannot escape the skills dir.
- **Prototype pollution.** `resolve.ts:130` uses `Object.hasOwn` for the
  `pique:` group lookup, so `pique:toString` raises instead of resolving.
- **Automaton refs.** An automaton cannot name an unenabled package into a run;
  `resolveExtensionRefs` requires a human to have enabled it somewhere on the
  chain.

## Order of work

Finding 1 is the one that changes what an attacker can do, and it is a design
change worth its own discussion. 2, 3, 4 and 5 are small mechanical diffs. 6 is
a comment.
