# hello, ivy

A minimal [`deno desktop`](https://docs.deno.com/runtime/desktop/) app: a single,
blank page that says **hello, ivy**, rendered in a native OS window.

## Prerequisites

- **Deno v2.9.0 or newer** (`deno desktop` was introduced in 2.9). Check with
  `deno --version`; upgrade with `deno upgrade`.
- On **Linux**, the default `webview` backend uses the system WebKitGTK
  (`libwebkit2gtk`); install it via your package manager if the window fails to
  open. macOS and Windows use their built-in webviews, so no extra install.

## Run it

Development, with hot reload:

```sh
deno task dev
# same as: deno desktop --hmr main.ts
```

## Build a standalone binary

```sh
deno task build
# same as: deno desktop main.ts
```

This produces a self-contained executable that bundles your code, the Deno
runtime, and the rendering backend. Run it directly:

```sh
./main       # macOS / Linux
.\main.exe   # Windows
```

## How it works

- `main.ts` is the entry point. It calls `Deno.serve()` with a handler that
  returns the HTML page. `deno desktop` opens a native window pointed at a local
  HTTP server bound to that handler — `Deno.serve()` auto-binds to the address
  the webview navigates to, so no port wiring is needed.
- `deno.json` holds the `desktop` config block: `app.name` (window title),
  `app.identifier` (reverse-DNS bundle id), and `backend`.

## Backends

`backend` in `deno.json` (or `--backend` on the CLI) selects the renderer:

- `webview` (default) — the OS's own webview (WebKit / WebView2). Small binaries.
- `cef` — bundled Chromium. Larger, but identical rendering on every platform.

```sh
deno desktop --backend cef main.ts
```

## Note on verifying the UI

This app was scaffolded in a headless container with no display, so the GUI
window could not be launched there to confirm the page renders. Run one of the
commands above on a machine with a desktop environment (and Deno 2.9+) to see
the **hello, ivy** window.
