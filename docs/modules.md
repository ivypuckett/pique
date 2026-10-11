# User Modules

How a panel of your own gets into pique's right pane, what it can reach, and —
at the end — what this version deliberately does not do.

Every capability surface before this one reaches the **agent**: an extension
registers tools, a skill teaches it, a prompt template steers it. A module is
the first that reaches **you** — it draws. It is how pique grows UI it does not
ship: when you want a Kanban board, ask the agent for one.

## Where a module comes from

**Ask the agent.** `define_module` writes the panel and its definition into
pi's extensions dir, and the module is on the rail as soon as the call returns —
the chat re-reads the module table when the tool succeeds. The tool exists for
what its description carries: the agent holds `write` and could put the files
there itself, but this is where it learns what a module is.

**Write the files yourself.** Drop them in the same dir, then reopen the app (or
let any `define_module` call refresh the rail).

There is no consent step. A module is trusted the way an extension is — see
[Trust](#trust).

## Two files

A module is an extension that also draws, so it lives where extensions live:

```
~/.pique/agent/extensions/
  notes.module.json     what it is called
  notes.ui.html         the single document its frame runs
  notes.ts              OPTIONAL — the pi extension, if it registers tools too
```

The module's **kind** is the filename, never a field inside the file. A
definition therefore cannot claim to be a module other than the one it sits
beside, and it cannot claim to be `terminal`.

`notes.ts` is optional and most modules will not have one. A panel that only
draws needs no pi extension, and on Deno 2.9.5 a malformed one panics the app at
boot — so do not add a file whose only job is to exist.

```json
{
  "label": "Notes",
  "duplicable": false
}
```

Any other key is ignored, so a definition written for an older build (one with
`capabilities` or a `rationale`) still loads.

## One document

**A module is one HTML file, with its own script and style inside it.** The
module server serves that document and nothing beside it, so a relative
`<script src="app.js">` 404s — `define_module` refuses one rather than letting
it fail where the agent cannot see. An absolute URL (a library from a CDN)
loads: the frame can reach the network.

## Talking to pique

The frame is served from the module server's own port, so it is a different
origin from the app's window and cannot reach `globalThis.bindings` directly.
pique posts it a `MessagePort` once its document loads instead. Keep it and
speak on it:

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
  const saved = await call("storageGet");
  document.body.textContent = JSON.stringify(saved);
}
</script>
```

Your frame never sends its own name, and is never asked for it. pique holds it,
so a call is always the calling module's own.

## What you may call

| Method       | Payload              | Does                                                     |
| ------------ | -------------------- | -------------------------------------------------------- |
| `storageGet` | —                    | your own JSON blob, `null` until you have written one    |
| `storageSet` | any JSON value       | replaces it (`~/.pique/modules/<name>.json`)             |
| `fsRead`     | `{ path }`           | the text of a file                                       |
| `fsWrite`    | `{ path, contents }` | writes a file                                            |

Anything else is refused as "not a module method". Paths are not restricted.

## Trust

pique adopts pi's philosophy: nothing is gated or sandboxed by pique. A module
runs with no consent screen, no capability list and no content-security policy,
and the methods above reach the whole filesystem. What it is kept out of is the
app's own window — a different origin, so it cannot call `win.bind` handlers or
read the app's DOM — which is a property of where it is served, not a policy.

Sandboxing is left to whoever wants it: an extension can intercept what an agent
writes (`pi.on("tool_call")`), and a stricter module host would be its own
change. See [security.md](security.md) for where this sits among pique's
boundaries.

## Deleting

Settings → Library lists every module beside the extensions; Delete removes both
files. A view that had the module open falls back to another row on the next
launch, and its tab is kept but unreachable — writing the module again brings the
row back with the tab where you left it.

## Deliberately absent

- **Sending a prompt to the chat.** Drafted once and cut: nothing implemented
  it.
- **A `ctrl+t` letter.** The chord is a fixed namespace, and an install claiming
  a letter could shadow a built-in. Modules are reachable from the rail, and
  with `ctrl+t ↑`/`↓`.
- **Hot-add from disk.** A module written by hand appears after the rail is
  re-read; it does not materialise into an open view on its own.
- **Tailwind, daisyUI and the app's theme.** A module brings its own styling.
  Tying every module to our build's class set is exactly the coupling a
  separate document avoids.
