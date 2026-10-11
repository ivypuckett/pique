# Security

Where pique's trust boundaries actually are, what holds them, and — at the end —
what is known weak and what a review has already cleared. Audited 2026-08-15
against `285c17e`, desktop runtime only; all six findings were fixed on
2026-08-17. Since then pique has dropped its own gates — the review queues, the
module sandbox and consent screen, automatons and subagents — in favour of pi's
model, where an extension is trusted code. The findings that concerned removed
code are gone from this page (git keeps them); the rest keep their numbers and
their reasoning, because the reasoning is the part worth re-reading.

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

## Modules: kept out of the window, not sandboxed

A user module's document ([modules.md](modules.md)) runs in an iframe served
from the module server's own port. That makes it a different origin from the
app's window, so it cannot reach `globalThis.bindings` or the app's DOM; it asks
for things over a `MessagePort` instead. That separation is the whole of it.
There is no `sandbox` attribute, no content-security policy and no capability
check: the four methods a module can call (`storageGet`, `storageSet`, `fsRead`,
`fsWrite`) reach the whole filesystem, and the frame can reach the network.

A module is therefore trusted the way an extension is. An agent holding `write`
can write one as easily as it can write an extension, and `define_module` does
exactly that.

## No gates

Nothing pique loads passes a human first. An extension, a prompt template, a
skill, a module, `SYSTEM.md` — each is in use as soon as it is in pi's agent dir
(`~/.pi/agent`, shared with the `pi` CLI). The one confirm left is before
installing a package, because `npm install` runs the package's own scripts as it
downloads.

That is pi's philosophy rather than an oversight, and it is honest about the
boundary below: an agent holding `write` and `bash` could always put a file in
the live dir directly, so the quarantine dirs pique used to keep were advisory
at best. Containment, for whoever wants it, belongs in an extension —
`pi.on("tool_call")` is where one would intercept what an agent does.

---

## Findings

### 2. The UI server binds to every interface on a fixed port — MEDIUM — FIXED

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

**Fixed.** `Deno.serve({ hostname: "127.0.0.1" }, …)`. The port is deliberately
left at 8000: deno desktop auto-navigates the adopted window to the served
address (`desktop.ts` head comment), so `port: 0` would need that to read the
bound port first, and the collision is a nuisance rather than the finding.
Verified by running the call in isolation — loopback answers 200, the host's LAN
address refuses.

### 3. Credentials are written with default file permissions — MEDIUM — FIXED ON POSIX

`providers.ts:writeModelsJson` writes `~/.pi/agent/models.json` — which holds
`apiKey` for a custom provider, via `buildCustomEntry` — with
`Deno.writeTextFile` and no `mode`. That is `0o666 & ~umask`, so **0644** on a
stock machine: any other user on the host can read the key.
`settings/file.ts:writeJson` has the same shape for `~/.pique/*.json`, and the
`Deno.mkdir` calls beside both leave their directories 0755.

**Fixed on Linux and macOS.** `{ mode: 0o600 }` on both writes, `{ mode: 0o700 }`
on both mkdirs. Deno applies `mode` on every write rather than only at creation —
verified — so an install that already wrote `models.json` at 0644 is narrowed on
the next save, and no migration step is needed. `auth.json` is written by pi
itself and is upstream of pique; still worth confirming what it does rather than
assuming.

**Not fixed on Windows, and the mode bits do not report that.** Deno accepts
`mode` there and silently ignores it — no error, no warning — so
`writeModelsJson` and `writeJson` appear to succeed while leaving the files at
whatever the inherited ACL grants, which on a shared machine can include other
local users. The bits are still correct to pass (they cost nothing and are right
on the other two platforms), but the protection is POSIX-only and this entry
should not be read as saying otherwise. Closing it needs an ACL equivalent —
`icacls <file> /inheritance:r /grant:r %USERNAME%:F`, or the same via the Win32
API — plus a Windows machine to verify it on, which is why it is recorded as
open rather than guessed at. Decision 3 in the README names Windows a supported
target, so this is a gap to close, not a platform to write off.

Not fixable by a mode bit, and worth stating plainly next to the decision to
share those files with the `pi` CLI: the chat agent has `read` and its cwd is
usually `$HOME`, so it can read both files and send them anywhere. That is the
direct cost of "this is not a sandbox".

### 5. The theme value validator does not block `url()` — LOW — FIXED

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

**Fixed.** `UNSAFE_VALUE_RE` is now `/[{}@;<>]|\b(?:url|image-set)\s*\(/i`.

---

## Verified clean

Recorded because the coverage is the point — a finding list alone does not say
what was looked at.

- **Path traversal.** Every filesystem path pique builds routes through an
  anchored validator: `paths.ts:assertId`, `assertExtensionName`,
  `assertPromptName`, `assertSkillName`, and `settings/file.ts`'s config
  `NAME_RE`. `fs.ts:parseEntryName` refuses absolute paths and `.` / `..`
  segments. No traversal found on any `win.bind` path. (A module's own
  `fsRead`/`fsWrite` take any path, by design — see
  [Modules](#modules-kept-out-of-the-window-not-sandboxed).)
- **Command injection.** Every `Deno.Command` is an argv array with no shell:
  `git.ts`, `dialog.ts` (xdg-open), and the PTY spawn in `terminal/pty.ts`.
  `openUrlCommand` is https-only and its one caller passes a compiled-in
  constant.
- **HTML injection.** No `{@html}`, `innerHTML`, `eval` or `new Function`
  anywhere in `src/`. Svelte's auto-escaping is what keeps model output out of
  the binding surface (see [The two boundaries](#the-two-boundaries)); it is
  worth a lint rule pinning it. Theme CSS reaches the DOM as `textContent` on a
  `<style>` element, which does not parse HTML, and theme names and property
  names are regex-constrained.
## What is still open

Nothing from this review. The boundary that does not hold is unchanged and is
not a finding but the design: there is no sandbox, the chat agent has `read` and
`bash` with its cwd usually `$HOME`, and nothing between an agent and pi's agent
dir. `tool_call` interception, in an extension, is the piece of work that would
change that, and its path set must cover all of `~/.pi/agent`.
