# User Modules

How a panel of your own gets into pique's right pane, what it may reach, and —
at the end — what is measured, what is assumed, and what this version
deliberately does not do.

Every capability surface before this one reaches the **agent**: an extension
registers tools, a skill teaches it, a prompt template steers it. A module is
the first that reaches **you** — it draws.

## Two files

A module is an extension that also draws, so it lives where its extension lives:
beside it, in the scope's extensions dir.

```
~/.pique/scopes/<root|ws-N>/agent/extensions/
  notes.module.json     what it is and what it asks for
  notes.ui.html         the single document its frame runs
  notes.ts              OPTIONAL — the pi extension, if it registers tools too
```

The module's **kind** is the filename, never a field inside the file. A
definition therefore cannot claim to be a module other than the one it sits
beside, and it cannot claim to be `kanban`.

`notes.ts` is optional and most modules will not have one. A panel that only
draws needs no pi extension, and on Deno 2.9.5 a malformed one panics the app at
boot — so do not add a file whose only job is to exist.

```json
{
  "label": "Notes",
  "duplicable": false,
  "capabilities": {
    "kanban": true,
    "storage": true,
    "fs": { "read": ["/home/you/notes"] }
  }
}
```

An unknown capability name is an error, not an ignored key: a typo'd `fs.raed`
that parsed as "grants nothing" would show as enabled in the consent screen and
then fail at runtime with nothing to explain it.

## One document, everything inlined

**A module is one HTML file. Its script and style go inside it.** No `app.js`,
no `style.css`, no image files.

This is the constraint most likely to read as a bug, so here is why. The frame
is sandboxed with no `allow-same-origin`, which makes its origin _opaque_. Two
things follow, both measured rather than assumed:

- It cannot `fetch` even the server that served it. Its own data files are
  unreachable at runtime.
- `'self'` in the frame's CSP matches nothing, so `script-src 'self'` does not
  let it load its own `app.js` either. This was checked against a no-CSP control
  of the same page: the files load with no header and are refused with one.

Everything that is not in the document arrives over the port instead.

## Talking to pique

pique posts your frame a `MessagePort` once its document loads. Keep it and
speak only on it:

```html
<script>
let port = null, next = 1;
const waiting = new Map();

window.addEventListener("message", (e) => {
  if (e.data !== "pique:module-port" || !e.ports[0]) return;
  port = e.ports[0];
  port.onmessage = (ev) => {
    const { id, ok, value } = ev.data;
    const seat = waiting.get(id);
    if (!seat) return;
    waiting.delete(id);
    ok ? seat.resolve(value) : seat.reject(new Error(String(value)));
  };
  start();
});

function call(method, payload) {
  const id = next++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    port.postMessage({ t: "call", id, method, payload });
  });
}

async function start() {
  const board = await call("kanbanGetBoard", {});
  document.body.textContent = `${board.statuses.length} columns`;
}
</script>
```

Your frame never sends its own name or scope, and is never asked for them. pique
holds both, which is what makes them impossible to forge rather than merely
checked.

## What you may ask for

| Capability | Methods                           | Grants                                            |
| ---------- | --------------------------------- | ------------------------------------------------- |
| `kanban`   | `kanbanGetBoard`, `kanbanGetLogs` | read the board of the scope you are open in       |
| `storage`  | `storageGet`, `storageSet`        | your own JSON blob, private to you and that scope |
| `agent`    | `agentPrompt`                     | send a prompt to this view's chat                 |
| `fs.read`  | `fsRead`                          | read files under the roots you declared           |
| `fs.write` | `fsWrite`                         | write files under the roots you declared          |

The method list is closed: anything not in that table is refused even to a
module that was granted everything. Read does not imply write, an empty root
list grants nothing, and a relative path is refused rather than resolved.

There is no network capability. See [Deliberately absent](#deliberately-absent).

## The gate

> A module **runs** iff its definition is in the scope's `extensions/` dir. It
> is **awaiting consent** iff there is one in that scope's `pending/` dir.

The same rule extensions follow, for the same reason: both halves are things the
filesystem already tells us, so there is no separate "approved" flag that could
disagree with what actually loads.

| Step    | What happens                                                   |
| ------- | -------------------------------------------------------------- |
| Arrive  | both files land in `pending/`                                  |
| Review  | the Library row expands into the consent screen                |
| Consent | both files move to `extensions/` together                      |
| Appear  | after a Refresh — a running view is not rewired underneath you |
| Revoke  | both move back to `pending/`; the row leaves the rail          |

Consent re-reads and re-validates the definition at the moment you press it, not
when the row was drawn: a Library tab can sit open all day, and the file can
change in between.

Revoke is not delete. Re-enabling means consenting again, so a capability list
that grew since cannot ride in on a past yes.

A view that had the module open falls back to another row on the next launch,
and its tab is kept but unreachable — re-enabling brings the row back with the
tab where you left it. (Before that fallback existed, such a view opened on
"Unknown module" with nothing selected on the rail and no close button, since a
singleton row has no tab strip: the tab could not be dismissed without editing
`layout.json` by hand.)

## Scopes

A module belongs to the scope whose dir holds it. Root's modules are visible
from every workspace and are consented to and revoked _in root_; a workspace's
are its own. A module always addresses the scope that owns it — root's Notes
reads root's board, whichever workspace you opened it from.

## What the frame cannot do

Measured against the real webview (WebKitGTK 605.1.15), not read from a spec:

| Attempt                        | Result                      |
| ------------------------------ | --------------------------- |
| `parent.bindings`              | `DOMException`              |
| `top.location`                 | `DOMException`              |
| `parent.document`              | `DOMException`              |
| `localStorage`                 | `DOMException`              |
| `fetch` anything               | blocked                     |
| `new Image().src` to a server  | blocked **by the CSP**      |
| `sendBeacon`, `WebSocket`      | blocked **by the CSP**      |
| a capability it wasn't granted | refused by the broker       |
| naming another module's id     | ignored — pique supplies it |

The distinction in that table is worth keeping: the sandbox blocks the first
five, and the **CSP** blocks the network ones. A sandboxed frame without the
header reached a recording server through six separate channels — `img.src`,
no-cors `fetch`, `sendBeacon`, `<script src>`, `<link href>` and `WebSocket`.
The sandbox is a boundary against pique's process, not against the network.

One consequence for your own error handling: under the CSP, five of those six
still _report success_ to JavaScript. Only `WebSocket` throws. A frame cannot
tell you its request was blocked, so do not build on one noticing.

## Deliberately absent

- **Network.** Not an oversight and not a broker setting: an `<img>` tag never
  asks permission, so the only place to allow it is the CSP header, per named
  host, with the consent screen naming those hosts. Until that exists, a module
  reads what it is granted and shows it.
- **A `ctrl+t` letter.** The chord is a fixed namespace, and an install claiming
  a letter could shadow a built-in. Modules are reachable from the rail and the
  `+` picker.
- **Hot-add.** An enabled module appears after a Refresh; it does not
  materialise into an open view.
- **Tailwind and daisyUI.** The frame gets the theme's colours as CSS custom
  properties. Tying every module to our build's class set is exactly the
  coupling the frame exists to avoid.

## Known weak

The gate is **advisory**, in the same sense the extension gate is
([extensions.md](extensions.md)): it governs what a human moves into the loading
set, not what can appear there. An agent holding `write` can put a definition
straight into `extensions/`, capabilities and all, without a consent screen ever
being drawn.

What that agent still cannot do is exceed the manifest it wrote: the broker
enforces on every call, and the CSP is on the document whatever the definition
says. So the blast radius of a dropped-in module is what its own manifest names,
in one scope — not the `-A` process. That is the property this design buys, and
it is the one to check first if any of it is ever changed.

See [security.md](security.md) for where this sits among pique's boundaries.
