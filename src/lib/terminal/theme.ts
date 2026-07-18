// Derives an xterm theme from the active daisyui theme so the terminal tracks
// whatever daisyui theme is in effect. xterm renders to its own canvas and never
// sees our CSS, so we resolve the daisyui custom properties to concrete colors and
// hand them over as an ITheme.
//
// daisyui only exposes semantic colors (primary, error, ...), not a full 16-color
// ANSI palette, so the ANSI slots are mapped to the closest semantic role. bg/fg/
// cursor come straight from the base + primary colors.

import type { ITheme } from "@xterm/xterm";

// Resolve `var(--name)` values (any format: hex, oklch, ...) to rgb strings by
// letting the browser compute them on a throwaway element inside the themed tree.
function resolveVars(el: HTMLElement, names: string[]): Record<string, string> {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.display = "none";
  el.appendChild(probe);
  const out: Record<string, string> = {};
  try {
    for (const name of names) {
      probe.style.color = "";
      probe.style.color = `var(${name})`;
      out[name] = getComputedStyle(probe).color;
    }
  } finally {
    probe.remove();
  }
  return out;
}

export function xtermThemeFromDaisyui(el: HTMLElement): ITheme {
  const v = resolveVars(el, [
    "--color-base-100",
    "--color-base-300",
    "--color-base-content",
    "--color-primary",
    "--color-secondary",
    "--color-accent",
    "--color-neutral",
    "--color-info",
    "--color-success",
    "--color-warning",
    "--color-error",
  ]);

  const bg = v["--color-base-100"];
  const fg = v["--color-base-content"];
  const black = v["--color-base-300"];
  const red = v["--color-error"];
  const green = v["--color-success"];
  const yellow = v["--color-warning"];
  const blue = v["--color-info"];
  const magenta = v["--color-secondary"];
  const cyan = v["--color-accent"];
  const white = v["--color-base-content"];

  return {
    background: bg,
    foreground: fg,
    cursor: v["--color-primary"],
    cursorAccent: bg,
    selectionBackground: v["--color-neutral"],
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    // No separate bright palette in daisyui; reuse the normal slots, lifting
    // "bright black" to neutral so dim/grey text stays visible on the base bg.
    brightBlack: v["--color-neutral"],
    brightRed: red,
    brightGreen: green,
    brightYellow: yellow,
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: white,
  };
}
