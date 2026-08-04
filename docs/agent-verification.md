# Verifying pique as an agent

How to manually test pique from the Browser pane. Written after actually doing
it — it saves you the dead ends. All claims below were verified end-to-end on
2026-07-20.

## Run it: web mode, not the desktop app

- **`preview_start {name: "web"}`** — starts the Vite dev server
  (`.claude/launch.json`) at `http://localhost:5173`. This is the surface you
  can observe.
- **`deno task dev`** builds and launches the real app in a **native webview
  window** (`./pique/pique`). You cannot screenshot or drive that window from
  here. Use it only when you need the actual backend (PTY, agent, fs) — and then
  verify by other means.

## Web mode degrades gracefully — know what's live

There is no desktop backend in web mode, so every `win.bind` handler is absent
(`globalThis.bindings` is undefined). The UI detects this and shows placeholders
instead of breaking:

- **Terminal, Chat, File tree** → "… unavailable — run the desktop app."
  (backend-bound)
- **Config persistence** → in-memory only; a reload resets theme/layout to
  defaults.

What _does_ work in web mode, and is worth testing here:

- Layout shell: workspaces, views, tabs, split columns, collapse/expand, reset.
- Keyboard chords and shortcuts (`ctrl+h`/`ctrl+j` prefixes, `ctrl+b`, `ctrl+,`,
  `ctrl+e`).
- Settings modal UI and the theme switcher (applies live to
  `<html data-theme>`).
- The Library module's chrome — the `+` menu entry, the Extensions/Prompts
  sub-tabs, the scope toggle. The lists themselves need the desktop app.

## The one big gotcha: `computer` actions hang

**`computer` (screenshot / click / zoom / key / scroll) times out (~30s) in this
pane** — and not because of pique. It hangs on `https://example.com` too, so
treat it as a pane-wide limitation of this environment. **Do not screenshot.**
You will get no visual, only wasted turns.

Everything you need is available through the text-based tools, which all work
fine:

| Want to…                     | Use                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| See page structure / content | `read_page`, `find`, `get_page_text`                                                                                                             |
| Click a button               | `javascript_tool`: `document.querySelector(sel).click()` — Svelte responds to synthetic clicks                                                   |
| Set a `<select>`/input       | `form_input` on the element's `ref` from `read_page`                                                                                             |
| Fire a keyboard shortcut     | `javascript_tool`: `window.dispatchEvent(new KeyboardEvent('keydown', {code:'Comma', ctrlKey:true}))` — the app listens on capture-phase keydown |
| Read state to assert on      | `javascript_tool` (e.g. `document.documentElement.dataset.theme`)                                                                                |
| Check for errors             | `read_console_messages`, `preview_logs`, `read_network_requests`                                                                                 |

### Worked example: verify the theme switcher

```js
// 1. open settings (ctrl+,)
window.dispatchEvent(
  new KeyboardEvent("keydown", { code: "Comma", ctrlKey: true }),
);
```

Then `read_page` to get the theme `<select>`'s ref,
`form_input {ref, value:"nord"}`, then assert:

```js
document.documentElement.dataset.theme; // => "nord"
```

That's the whole loop — drive with `form_input` / dispatched events, assert with
a JS read. No `computer` needed.
