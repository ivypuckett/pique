# Keybindings

Everything is driven from `App.svelte`'s single capture-phase `keydown` listener,
and everything it can do is spelled out in the status bar at the bottom of the
window. `ctrl` below is `cmd` on a Mac.

## Chords

Three tmux-style prefixes. Press one to arm a mode — the status bar swaps to that
mode's key list — then press a key. A mode exits on `esc`, on any key it does not
recognise, or after 2s idle. Pressing another prefix while one is armed switches
modes rather than counting as an unrecognised key.

| Prefix | Mode | Keys |
| --- | --- | --- |
| `ctrl+h` | view | `n` new · `w` close · `h`/`l` previous/next · `enter` focus |
| `ctrl+j` | workspace | `n` new · `o` open a folder · `w` close · `k`/`j` up/down · `enter` focus |
| `ctrl+t` | pane | `e` explorer · `t` terminal · `g` git diff · `k` kanban · `b` library · `a` automatons · `n` new · `w` close · `↑`/`↓` rail row · `h`/`l` previous/next tab · `1`-`9` jump · `enter` focus |

The pane chord's letters are the module rail's rows, one letter each, and they
**show** a row rather than adding to it: `ctrl+t k` twice is still one Kanban.
`n` is what adds — one more of whatever row you are on, so `ctrl+t n` is a second
terminal. Only a row that may hold more than one answers it.

`b` is Library because `l` is worth more as "next tab" — the strip is something
you move along far more often than you open a library. The rail moves on `↑`/`↓`
rather than `j`/`k` for a plainer reason: `k` is already Kanban's, and every row
has a letter, so the arrows are a convenience rather than the way in.

### Sticky and one-shot

Navigation keys are **sticky**: they re-arm the mode, so `ctrl+t h h h` walks
three tabs left, `ctrl+t ↓ ↓` moves two rail rows down, and `ctrl+j j j` moves
down two workspaces. Keys that *show or open* something are **one-shot** — the
mode drops immediately, so the first thing you type into what you just opened is
not eaten by the chord handler.

`ctrl+t w` closes without confirming; `ctrl+j w` asks first. A tab is one module,
a workspace takes every view and tab in it. Closing a row's last tab leaves that
row selected, showing the key that would open another — it does not move you
somewhere else.

### Focus

Every chord stroke changes what is on screen, so every one of them ends in
`settleFocus`, which does two things: takes the caret **out** of a tab pane that
is no longer shown, and puts it **into** a terminal that now is.

The first half is why it exists. Switching view, workspace or tab does not move
focus on its own, so without it the caret stays in the terminal you just
navigated away from — one that is now `display:none` — and everything you type
goes to a shell you cannot see. The second half is the convenience: a terminal
you cannot type into is not one you really opened.

Terminals only, on the way in. The helper focuses a pane's first focusable
element, which for a terminal is xterm's textarea but for Kanban is the first
column's rename field — so focusing every module would turn a stray keystroke
after `ctrl+t k` into a renamed column. Everything else keeps focus where it
already was. `ctrl+t` additionally reveals the right pane if it was collapsed.

`ctrl+t e` is the one exception that focuses something else: it selects the
explorer row and puts the caret in the file tree, which is an explicit step in
its handler rather than anything `settleFocus` does.

`enter` means "take me to what is on screen now": settle focus, leave the mode.
It earns an explicit case for a reason worth remembering — a key a mode does
*not* recognise exits **without swallowing the stroke**, which then lands
wherever focus is. Since focus after a chord is so often a terminal, a
fall-through `enter` would run whatever was sitting on its command line.

## Plain shortcuts

No prefix, no mode.

| Key | Action |
| --- | --- |
| `ctrl+b` | show/hide the workspace rail |
| `ctrl+shift+b` | collapse/expand the right pane |
| `ctrl+,` | settings |
| `ctrl+=` / `ctrl+-` / `ctrl+0` | zoom in, out, reset |

Bindings are matched on `event.code`, not `event.key`: `ctrl+shift+=` is how `+`
is typed on most layouts, and reading `key` there would see `+` on one keyboard
and `=` on another.

## Not implemented: moving tabs

`shift+h` / `shift+l` inside the tab chord to drag the active tab along the strip
is the obvious next key, and the chord has room for it. It is deliberately not
built.

Every other pane chord key is a keyboard path to something the mouse can already
do — the rail opens modules, `+` adds one more, the `×` closes them, clicking a
tab selects it.
Reordering is not: the tab strip has no drag handles and no context menu, so
`shift+h`/`shift+l` would be the *only* way to reorder, and a capability that
exists on exactly one input is a capability most users never find.

Building it properly means a `moveTab(v, dir)` reducer beside `focusAdjacentTab`
in `layout.ts` **and** drag-reordering in `TabStrip.svelte`. That is a tab-strip
feature that happens to get a shortcut, not a shortcut — which is why it wants
its own change rather than a line in the chord's switch.
