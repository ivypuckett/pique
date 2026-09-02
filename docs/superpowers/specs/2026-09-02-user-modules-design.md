# User Modules — Design

**Date:** 2026-09-02 **Status:** Proposed. Nothing below is implemented. The
frame spike ran on 2026-09-02; its results are in
[The frame, measured](#the-frame-measured) and they changed three decisions.
Implementation plan:
[2026-09-02-user-modules.md](../plans/2026-09-02-user-modules.md).

## Purpose

Let a user add a right-pane module of their own — a panel with its own UI, its
own data, and a row on the module rail — without building pique.

Today capability reaches the agent (extensions, skills, prompts, automatons,
subagents) but the window is fixed: the seven kinds in
[registry.ts](../../../src/lib/modules/registry.ts) are all there will ever be,
because Vite bundles them into the binary. A user who wants a panel for their
own data has no move that does not involve a fork.

The mechanical half of this is small. The whole of the design is where the
user's code runs, and what it is allowed to reach when it gets there.

## Scope

**In:**

- A module kind contributed by an installed extension, rendered in a sandboxed
  iframe, appearing on the rail and in the `+` picker like a built-in.
- A capability manifest, consented to at enable time and **enforced at the
  broker on every call** — not merely displayed.
- One `moduleCall` bind and one long-poll `moduleEvents` bind, both registered
  at boot, dispatching to the extension's Deno-side handler.
- The module list becoming a runtime value: `MODULES` plus what the current
  scope has enabled.
- Reuse of the Library's whole acquisition half — pending/, review-the-bytes,
  enable, revoke, delete, scope inheritance.

**Out (deferred):** user modules in the center column (chat's slot) or the
editor row; a `ctrl+t` letter for a user module (decision 9); hot-add without a
refresh (decision 10); an in-app editor; a module registry or marketplace;
anything that gives a module DOM access to the host document.

## Terminology

- **Module** — a pane kind: a rail row, a tab, a component. Currently built-in
  only.
- **Extension** — unchanged, per [extensions.md](../../extensions.md): the unit
  you acquire, review, enable and revoke, which registers tools.
- **User module** — an extension that additionally declares a `module:` block.
  Not a new install system; a second thing an extension may contribute.

The unification is the point. An extension that ships a tool and a panel over
the same data is one row in the Library, one review, one revoke.

## What exists today (verified 2026-09-02 against `a437063`)

A built-in module is three things, all compile-time:

| Piece              | Where                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Metadata           | `MODULES` in [manifest.ts](../../../src/lib/modules/manifest.ts:27)    |
| Component          | static import in [registry.ts](../../../src/lib/modules/registry.ts:9) |
| Backend capability | `win.bind` handlers in [desktop.ts](../../../src/desktop.ts)           |

Four facts from reading them decide most of this design:

1. **The manifest is already the single source.** Its own header records that
   four places used to carry a piece of this and drift apart; today
   `moduleLabel`, `addTab`'s singleton rule, `railGroups`, the `ctrl+t` chord in
   [App.svelte:277](../../../src/App.svelte:277) and the hint row in
   [StatusBar.svelte:32](../../../src/lib/StatusBar.svelte:32) all read it.
   Making the list a runtime value is therefore a change to one function's
   return, not a sweep.
2. **An unknown kind already degrades safely.**
   [Column.svelte:96](../../../src/lib/Column.svelte:96) renders "Unknown
   module" when `registry[tab.kind]` misses, and `isDuplicable` deliberately
   answers `false` for a kind it has never heard of — the conservative branch,
   written for layouts from another build. A layout naming a module that is
   uninstalled, revoked, or belongs to another scope is thus already a solved
   case, and stays solved.
3. **Binds cannot be added late.** [desktop.ts](../../../src/desktop.ts:1)'s
   header records it as hard-won: the window auto-navigates at the first yield,
   and a handler bound after that fails with "No callback bound", silently. So a
   user module can never register a bind of its own — hence the single generic
   `moduleCall` (decision 6).
4. **Push already has a shape.** `termRead` is a bounded 20s long-poll returning
   early on data ([desktop.ts:77](../../../src/desktop.ts:77)); module events
   copy it rather than inventing a channel.

## The frame, measured

A standalone `deno desktop` app (WebKitGTK, `AppleWebKit/605.1.15`, Linux) put a
sandboxed frame next to a real `win.bind` handler and had the frame probe its
way out. Every row below is measured, not reasoned.

| Probe, from inside `sandbox="allow-scripts"` | Result         |
| -------------------------------------------- | -------------- |
| `parent.bindings`                            | `DOMException` |
| `top.location.href`                          | `DOMException` |
| `parent.document`                            | `DOMException` |
| `localStorage`                               | `DOMException` |
| `fetch` the host page                        | `TypeError`    |
| `fetch` its **own** server                   | `TypeError`    |
| `postMessage`, frame → host and host → frame | works          |
| `MessageChannel` port transfer               | works          |
| host's own `win.bind` call, frames up        | works          |

Four consequences, in descending order of how much they change the design:

1. **The boundary holds.** Nothing the frame tried reached `bindings` or the
   host document. Decision 1 rests on this rather than on the attribute's
   documentation.
2. **RPC is the _only_ data channel** — decision 6 stops being a convenience and
   becomes the mechanism. An opaque origin cannot `fetch` even the server it was
   loaded from, so a module cannot read its own data files at runtime. Under
   decision 4's CSP it cannot load its own `<script src>` or `<link>` either,
   and `'self'` does not help — measured below. **A module is therefore one HTML
   document with its code inlined**, and everything else arrives over the port.
3. **`MessageChannel` works, so each frame gets a private port** rather than
   `postMessage(…, "*")` plus an origin check. The host holds the port and the
   `moduleId`, which is what makes a forged id impossible rather than merely
   detected.
4. **`location.origin` is not a sandbox check.** The `srcdoc` frame reported
   `null` and the served frame reported `http://127.0.0.1:<port>`, while both
   had `localStorage` blocked — WebKit reports the URL origin but enforces
   opacity. Blocked `localStorage` is the signal; any test asserting on
   `location.origin` would pass or fail for the wrong reason.

### Outbound requests: the sandbox does not stop them, the CSP header does

Measured separately, because the first run's CORS failures masked it. A frame
fired six requests at a server that recorded arrivals — so "blocked" here means
the request never left, not merely that the response was unreadable.

| Channel                      | Sandboxed frame | Same frame, CSP header |
| ---------------------------- | --------------- | ---------------------- |
| `new Image().src`            | **arrived**     | blocked                |
| `fetch(…, {mode:"no-cors"})` | **arrived**     | blocked                |
| `navigator.sendBeacon`       | **arrived**     | blocked                |
| `<script src>`               | **arrived**     | blocked                |
| `<link rel=stylesheet>`      | **arrived**     | blocked                |
| `WebSocket`                  | **arrived**     | blocked (throws)       |

Six for six, and every one is a channel that carries data outbound in the URL
while needing no readable response. **A sandboxed frame with no CSP has
unrestricted outbound network**, so `fs.read` plus a bare frame composes
directly into exfiltration. The sandbox attribute is a boundary against the host
process, not against the network, and this spec would have shipped believing
otherwise.

With `default-src 'none'; script-src 'unsafe-inline'` served on the frame
document, all six were blocked — nothing reached the server. The header is
therefore a real control and decision 4 makes it mandatory.

**`'self'` does not rescue the module's own files.** The obvious relaxation —
`script-src 'self' 'unsafe-inline'` so a module can ship `app.js` beside its
HTML — was measured against a no-CSP control of the same fixture:

| Frame                               | own `<script src>` | own `<link rel=stylesheet>` |
| ----------------------------------- | ------------------ | --------------------------- |
| no CSP header                       | **loaded**         | **loaded**                  |
| `script-src 'self' 'unsafe-inline'` | blocked            | blocked                     |

`'self'` resolves against the document's origin, and a sandboxed frame's origin
is opaque, so it matches nothing — the module's own port is refused exactly as
an external host is. The control is what makes this a finding rather than a
broken fixture: the same files load from the same server when the header is
absent.

**So a module is one HTML document with its code inlined.** That is a real
constraint on the authoring story and belongs in the module docs, not a
footnote: no `app.js`, no `style.css`, no image files — a single page, with
everything else arriving over the port. It is not onerous (the frame is a panel,
not an app) and it has a side benefit: the reviewable unit is one file, which is
the property the extension review gate already relies on.

(The fixture's `img` probe is not evidence either way — it pointed an `<img>` at
a stylesheet, which fails to decode whatever CSP says. The script and stylesheet
rows are the measured ones.)

One property worth keeping in mind when reading a module's own error handling:
under CSP the JavaScript still reports success for five of the six — the calls
"fire" and nothing throws except `WebSocket`. Blocking is invisible to the
frame, which usefully denies it an oracle, but means a frame cannot be trusted
to report its own failures.

A separate question stays open but blocks nothing: every `srcdoc` size step
failed, including 64 KB, which is small enough that the harness is the likelier
culprit than a real ceiling. Decision 3 serves files rather than inlining them,
so the answer is moot unless someone later wants `srcdoc` back — in which case
it must be re-measured, not read from here.

## The problem the tiers are answering

[security.md](../../security.md) is unambiguous: pique ships `deno desktop -A`,
there is no sandbox, and "model output → XSS → RCE is the shortest path to
compromise in this app" — which is why no-`{@html}` is a security property here
and not a style rule.

A user-authored component evaluated in the host document _is_ that XSS, granted
in advance. It shares a global with `globalThis.bindings` and can call every
handler in `desktop.ts` — `bash` through the agent, arbitrary writes, provider
credentials — with nothing in between. The review gate does not help: it is
[advisory by its own account](../../extensions.md), governing what a human
_moves_ into the loading set rather than what can appear there.

Three ways out were considered.

| Tier                       | Isolation            | Expressiveness   | Verdict                                 |
| -------------------------- | -------------------- | ---------------- | --------------------------------------- |
| Declarative manifest       | total — no user code | our widgets only | too narrow to be worth a new concept    |
| **Sandboxed iframe**       | a real boundary      | any HTML/CSS/JS  | **chosen**                              |
| Svelte compiled in-process | none                 | full             | rejected — equivalent to `curl \| bash` |

Tier 3 fails on a second count as well: Tailwind purges at build time, so a user
component's classes would not exist in the shipped CSS. It would need the Svelte
compiler _and_ a Tailwind runtime in the bundle to produce a panel that looks
like the rest of the app — a large cost for the least safe option.

## Decisions

1. **The user's code runs in a sandboxed iframe, never in the host document.**
   This is the decision the rest hang off. The boundary is enforced by the
   browser engine rather than by our discipline, which is the only kind of
   boundary this app can currently add — everything else in `desktop.ts` is
   inside the `-A` process.

2. **The iframe gets an opaque origin and no host DOM.**
   `sandbox="allow-scripts"` with no `allow-same-origin`: measured below, the
   frame cannot reach `parent.bindings`, `top.location`, `parent.document` or
   `localStorage` — every one throws `DOMException`.

3. **The frame's files are served from a second loopback port**, not inlined as
   `srcdoc`. The app already serves its frontend over loopback
   ([desktop.ts](../../../src/desktop.ts:900)); a second `Deno.serve` is a few
   lines and gets the module real files, real paths and no inlining step. The
   sandbox attribute still makes the frame's origin opaque, so this is not a
   weaker boundary than `srcdoc` — it is the same boundary with a better
   delivery mechanism. **The host server must be started first**: deno desktop
   navigates the adopted window to the _first_ `Deno.serve`, and starting the
   module server first silently loads a module page as the whole app. This is a
   fourth entry for the silent-when-violated list in desktop.ts's header.

4. **The frame document is served with
   `default-src 'none'; script-src
   'unsafe-inline'; style-src 'unsafe-inline'`,
   and a module is a single inlined HTML document.** Measured above: without it
   a frame has unrestricted outbound network through six different channels;
   with it, none of them reach anything. `script-src 'unsafe-inline'` and
   `style-src 'unsafe-inline'` are what the module needs to run and paint, and
   nothing else is granted. A network capability, if it is ever added, is this
   header relaxed by named host — not a flag checked in the broker, which an
   `<img>` tag would walk straight past.

5. **A user module is an extension with a `module:` block.** No second
   acquisition path, no second review gate, no second revoke. The block names
   the kind, label, entry file, and requested capabilities. An extension without
   one behaves exactly as today.

6. **One bind pair, registered at boot, dispatching by module id.**
   `moduleCall(moduleId, method, payload)` and `moduleEvents(moduleId)` — the
   only way constraint 3 above permits a late-arriving module to have a backend
   at all. `moduleCall` resolves the module's Deno-side handler from the
   extension pi already loaded for that scope.

7. **The broker enforces capabilities; the consent screen only explains them.**
   Every `moduleCall` is checked against the manifest the user consented to, in
   `desktop.ts`, before the handler runs. A displayed-but-unenforced manifest
   would be worse than none — it would put a security claim in the UI that the
   code does not keep. Initial set, deliberately small:

   | Capability | Grants                                                          |
   | ---------- | --------------------------------------------------------------- |
   | `fs.read`  | reads under declared globs, via the existing anchored validator |
   | `fs.write` | writes under declared globs                                     |
   | `kanban`   | the `kanbanGet*` binds for the module's scope                   |
   | `storage`  | the module's own JSON blob under its scope dir                  |
   | `agent`    | send a prompt to this view's chat                               |

   There is no `shell`, and no capability that composes into one. A module
   needing arbitrary execution should ship a tool and let the agent's own gates
   apply.

8. **Capabilities are scope-bound, like everything else.** A module enabled in
   `ws-2` addresses `ws-2`'s board and `ws-2`'s storage; the broker takes the
   scope from the view, never from the module's argument. This falls out of
   [scope/paths.ts](../../../src/lib/scope/paths.ts) and costs nothing to keep.

9. **User modules get a rail row and a picker entry, but no `ctrl+t` letter.**
   The chord's letters are a fixed namespace with real contention already
   recorded in the manifest (`b`, not `l`, for Library). Letting an install
   claim one means an install can shadow a built-in. The rail's arrows reach it;
   a user-assigned letter is deferred, not refused.

10. **The module list is rebuilt on enable and on refresh, not continuously.**
    Same posture as the Library's Refresh button and the same reason: enabling
    an extension already only affects sessions started afterwards
    ([library-unification](2026-08-08-library-unification-design.md) deferred
    #4). A newly enabled module appears in the picker after a refresh; it does
    not materialise into an open view.

11. **No Tailwind or daisyUI inside the frame.** The frame gets the theme's
    colours as CSS custom properties and nothing else. Shipping a utility
    framework across the boundary would tie every user module to our build's
    class set, which is exactly the coupling the iframe exists to avoid.

12. **`duplicable` is declarable; unknown stays singleton.** A module may ask
    for multiple tabs. A kind read back from a layout with no live definition
    keeps `isDuplicable`'s existing conservative `false`.

## Architecture

```
src/lib/modules/
  manifest.ts       MODULES stays; moduleDefs(scope) merges built-ins + installed
  registry.ts       gains one entry: "user" → UserModule.svelte (the iframe host)
  UserModule.svelte the host frame: mounts the iframe, relays postMessage ↔ binds
  broker.ts         Deno-side: capability check, scope binding, handler dispatch
  contract.ts       the RPC message shapes, shared by host and frame
  sdk.ts            the tiny client the frame imports: call(), on(), theme()
```

On disk, inside the extension's own directory — no new tree:

```
~/.pique/scopes/<id>/agent/extensions/my_panel/
  index.ts        the pi extension (tools, as today)
  module.json     { kind, label, entry, duplicable?, capabilities: {...} }
  ui.html         what the frame runs — one document, script and style inlined
```

The RPC is two messages each way, deliberately boring: `call`/`result` and
`event`/`ack`. The host holds the `moduleId` and the scope; the frame never
sends either, so a frame cannot address another module's data by lying about who
it is.

## Verification

- **Unit (`deno test -A src/`).** `moduleDefs` merging and precedence (a
  built-in kind always wins a collision); `isDuplicable`/`moduleLabel` over a
  runtime list; the broker's capability check, including the negative cases — an
  ungranted method, a glob escape, a scope mismatch, a forged `moduleId`. The
  existing `layout_test.ts` unknown-kind cases must keep passing untouched; they
  are the regression net for decision 12.
- **Manual, web mode** (`preview_start {name: "web"}`): a fixture module appears
  in the `+` picker and on the rail; the frame renders; `moduleCall` shows the
  desktop-only placeholder path, as Terminal and Chat do.
- **Manual, desktop** (`deno task dev`): install → review → consent → enable →
  refresh → open; the panel reads its data; revoking it leaves an open tab
  showing "Unknown module" rather than a broken frame; a second workspace does
  not see `ws-1`'s storage.
- **Adversarial, desktop.** The spike's probe set, kept as a fixture module and
  re-run against the real host: `parent.bindings`, `top.location`,
  `parent.document`, `localStorage`, a `moduleCall` outside its manifest, a
  `../` escape from its `fs.read` glob, and another module's id. Each must fail
  closed. Assert on the `DOMException`, never on `location.origin` (finding 4).
  Add the outbound-request probe once it is settled.

## Deferred

1. **A `ctrl+t` letter for user modules** (decision 9). Wants a rebindable
   keymap, which is its own design.
2. **Hot-add into an open view** (decision 10).
3. **Center-column and editor-row modules.** The right pane is the only slot
   with a picker, a rail and per-kind persistence already generalised.
4. **Module updates.** Inherits the package story: updates are
   [unified-extensions](2026-08-03-unified-extensions-design.md)'s deferred item
   and nothing here improves it.
5. **A capability for outbound network.** Wanted immediately by anything that
   talks to an API, and the one addition most likely to turn a panel into an
   exfiltration path for what `fs.read` granted. Deliberately not in the first
   set — and now known to be a CSP question rather than a broker one (decision
   4), so adding it later means relaxing the header per named host, with the
   consent screen naming those hosts.

## Known weak, stated plainly

The gate stays advisory. An agent holding `write` can drop a `module.json` into
the live extensions dir, and consent for capabilities can be requested by a
module the user did not read. This work does not fix that — it is
[security.md](../../security.md)'s standing finding about the agent → filesystem
boundary — but it does widen what the weakness touches from "tools the agent can
call" to "a panel with its own capability grant".

Two things keep that honest, and neither is optional to the design: the broker
enforces (decision 7), so a forged manifest still cannot exceed what it names;
and the frame is a real boundary (decision 1), so the worst a dropped-in module
achieves is what its manifest asked for, in one scope, rather than the `-A`
process.
