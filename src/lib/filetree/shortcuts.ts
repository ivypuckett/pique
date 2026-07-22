// Single source for the file tree's key bindings, so its two hint surfaces can't drift
// apart: the in-tree `?` overlay renders `shortcuts` in full, and the tree footer shows
// `gChordHints` while the `g` chord is armed. Keep both in sync when bindings change.

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

// Shown in the tree footer while the `g` chord is armed — its two follow-ups.
export const gChordHints: Shortcut[] = [
  { keys: ["g"], label: "top" },
  { keys: ["d"], label: "diff" },
];
