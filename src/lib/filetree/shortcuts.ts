import { writable } from "svelte/store";

// Single source for the file tree's key bindings, shared by its two hint surfaces so they
// can't drift apart: the in-tree `?` overlay renders `shortcuts` in full, and the status
// bar renders the compact `barHints` subset. Keep both in this file when bindings change.

export type Shortcut = { keys: string[]; label: string };

// Full list — the `?` overlay. `⏎` is the display glyph for Enter; `g g` / `g d` are the
// two-stroke chords handled in FileTree's onKey.
export const shortcuts: Shortcut[] = [
  { keys: ["j", "k"], label: "move down / up" },
  { keys: ["l", "⏎"], label: "open file / expand folder" },
  { keys: ["h"], label: "collapse / go to parent" },
  { keys: ["g", "g"], label: "jump to top" },
  { keys: ["G"], label: "jump to bottom" },
  { keys: ["g", "d"], label: "open git diff" },
  { keys: ["R"], label: "refresh" },
  { keys: ["?"], label: "toggle this help" },
];

// Compact subset for the status bar — the highest-traffic keys plus a pointer to `?`.
export const barHints: Shortcut[] = [
  { keys: ["j", "k"], label: "move" },
  { keys: ["l", "h"], label: "open / close" },
  { keys: ["?"], label: "help" },
];

// Revealed in the bar while the `g` chord is armed, mirroring how an armed ctrl-chord
// shows its sub-keys.
export const gChordHints: Shortcut[] = [
  { keys: ["g"], label: "top" },
  { keys: ["d"], label: "diff" },
];

// Live UI context the status bar reads so tree hints appear only while the tree is the
// focused surface. `pendingG` mirrors the tree's armed `g` chord.
export const fileTreeContext = writable<{ focused: boolean; pendingG: boolean }>({
  focused: false,
  pendingG: false,
});
