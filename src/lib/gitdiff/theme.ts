/// <reference lib="dom" />
// Picks git-diff-view's "light" | "dark" from the active daisyui theme so the diff
// tracks whatever theme is in effect. git-diff-view only distinguishes light vs dark,
// while pique ships several themes (some dark, some light), so we classify by the
// luminance of the base background rather than matching theme names — any future
// theme is handled without a lookup table.

// True when a resolved background color is dark enough to want a dark diff. daisyui
// themes resolve to either rgb()/rgba() or oklch()/oklab() depending on how the theme
// declares --color-base-100, so both forms are handled.
export function isDarkColor(color: string): boolean {
  const nums = color.match(/[\d.]+/g)?.map(Number);
  if (!nums || nums.length < 3) return true; // unreadable → assume dark
  // oklch()/oklab(): the first component is perceptual lightness in 0–1.
  if (/^okl(ch|ab)/i.test(color)) return nums[0] < 0.5;
  // rgb()/rgba(): sRGB relative luminance, normalized to 0–1.
  const [r, g, b] = nums;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

// Resolve --color-base-100 to a concrete color by letting the browser compute it on a
// throwaway probe inside the themed tree (the var may be hex, oklch, …), then classify.
export function diffThemeFromDaisyui(el: HTMLElement): "light" | "dark" {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.display = "none";
  probe.style.color = "var(--color-base-100)";
  el.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return isDarkColor(color) ? "dark" : "light";
}
