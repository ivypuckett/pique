// Reads and writes the CSS block daisyui's theme generator exports:
//
//   @plugin "daisyui/theme" { name: "light"; color-scheme: "light"; --color-base-100: …; }
//
// That block is pique's theme format on purpose — a theme pasted from
// daisyui.com/theme-generator works unedited, and a theme edited here pastes back.
// Nothing is compiled: a daisyui theme is only custom properties on a [data-theme]
// selector (see node_modules/daisyui/theme/*.css), and every component reads them
// through var() at runtime, so emitting the rule into a <style> at runtime is
// indistinguishable from having built it into the stylesheet.
//
// Pure — no DOM, no Deno APIs — so the parser is unit-testable and safe to bundle.

export interface Theme {
  name: string;
  // Quoted in the source block ("dark"), bare in the emitted rule (dark). Drives the
  // webview's native form controls and scrollbars, so it is worth carrying through.
  colorScheme?: string;
  // Parsed and preserved for round-tripping, but inert here: pique's theme is an
  // explicit setting, so there is no "default" to fall back to and no system-preference
  // following for prefersdark to hook into.
  default?: boolean;
  prefersdark?: boolean;
  // Ordered, not a record: a theme round-trips through the editor, and reordering
  // someone's declarations on save is the kind of churn that makes a diff unreadable.
  vars: { name: string; value: string }[];
}

// Theme names land in a CSS selector and in the settings file, so keep them to what
// daisyui itself uses — no quotes, spaces, or escapes to get wrong.
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const VAR_RE = /^--[a-zA-Z0-9_-]+$/;

// A pasted theme is text from somewhere else, and it is being injected into the app's
// own stylesheet. Values are custom properties (declaration position only, so no
// property injection), but a value carrying its own braces or an at-rule could close
// our rule and open something else — a url() that phones home, say. Reject the
// characters that would let a value escape the declaration it sits in.
const UNSAFE_VALUE_RE = /[{}@;<>]/;

const KNOWN_KEYS = ["name", "default", "prefersdark", "color-scheme"];

// Strip /* … */ so a commented-out declaration is not parsed, and so a trailing note
// (`--color-base-100: #303446; /* base */`) does not end up inside the value. The
// stored theme keeps its original text, so comments survive in the editor either way.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function unquote(v: string): string {
  const m = v.match(/^["'](.*)["']$/);
  return m ? m[1] : v;
}

// The body of one `@plugin "daisyui/theme" { … }` block, or of a bare `{ … }` — the
// braces are optional so a half-pasted block still parses rather than failing on a
// technicality. Everything before the first brace is discarded.
function bodyOf(css: string): string {
  const open = css.indexOf("{");
  if (open === -1) return css;
  const close = css.lastIndexOf("}");
  return css.slice(open + 1, close === -1 ? undefined : close);
}

// Throws on anything it cannot turn into a working theme, with a message meant to be
// shown verbatim next to the editor — the caller has no more context to add.
export function parseThemeCss(css: string): Theme {
  const theme: Theme = { name: "", vars: [] };
  for (const decl of bodyOf(stripComments(css)).split(";")) {
    const text = decl.trim();
    if (text === "") continue;
    const colon = text.indexOf(":");
    if (colon === -1) throw new Error(`expected "key: value", got "${text}"`);
    const key = text.slice(0, colon).trim();
    const value = text.slice(colon + 1).trim();

    if (key.startsWith("--")) {
      if (!VAR_RE.test(key)) throw new Error(`invalid property name: ${key}`);
      if (UNSAFE_VALUE_RE.test(value)) {
        throw new Error(`invalid value for ${key}: ${value}`);
      }
      theme.vars.push({ name: key, value });
      continue;
    }

    switch (key) {
      case "name":
        theme.name = unquote(value);
        break;
      case "color-scheme":
        theme.colorScheme = unquote(value);
        break;
      case "default":
        theme.default = value === "true";
        break;
      case "prefersdark":
        theme.prefersdark = value === "true";
        break;
      default:
        throw new Error(
          `unknown setting "${key}" — expected one of ${
            KNOWN_KEYS.join(", ")
          }, or a --custom-property`,
        );
    }
  }

  if (theme.name === "") throw new Error(`missing a name (name: "my-theme";)`);
  if (!NAME_RE.test(theme.name)) {
    throw new Error(
      `invalid name "${theme.name}" — letters, digits, - and _ only`,
    );
  }
  if (theme.colorScheme !== undefined && !/^(light|dark)$/.test(theme.colorScheme)) {
    throw new Error(`color-scheme must be "light" or "dark"`);
  }
  if (theme.vars.length === 0) {
    throw new Error("no --custom-properties — the theme would have no colors");
  }
  return theme;
}

// Several blocks in one string: what the seed sheet holds, and what a paste of more
// than one exported theme looks like. Splitting on the at-rule rather than on braces
// is enough because a block body cannot contain one (UNSAFE_VALUE_RE rejects `@`).
export function parseThemeSheet(css: string): Theme[] {
  return splitThemeSheet(css).map(parseThemeCss);
}

export function splitThemeSheet(css: string): string[] {
  return css
    .split(/(?=@plugin\s)/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

// The CSS rule that makes the theme live. Deliberately unlayered: daisyui's own output
// sits in @layer base, and an unlayered rule wins over any layer regardless of
// specificity, so a theme applies without a specificity arms race.
export function themeRule(theme: Theme): string {
  const lines = theme.vars.map((v) => `  ${v.name}: ${v.value};`);
  if (theme.colorScheme) lines.unshift(`  color-scheme: ${theme.colorScheme};`);
  return `[data-theme="${theme.name}"] {\n${lines.join("\n")}\n}`;
}

// Back to the daisyui block, for seeding a new theme from an existing one. Round-trips
// with parseThemeCss; the stored text is what the editor shows, so this is only used to
// author text the user has not written yet.
export function formatThemeCss(theme: Theme): string {
  const lines = [`  name: "${theme.name}";`];
  if (theme.default !== undefined) lines.push(`  default: ${theme.default};`);
  if (theme.prefersdark !== undefined) {
    lines.push(`  prefersdark: ${theme.prefersdark};`);
  }
  if (theme.colorScheme) lines.push(`  color-scheme: "${theme.colorScheme}";`);
  for (const v of theme.vars) lines.push(`  ${v.name}: ${v.value};`);
  return `@plugin "daisyui/theme" {\n${lines.join("\n")}\n}\n`;
}

// The name a block declares, without validating the rest — for the collision check the
// editor runs while typing, where an unfinished theme should not throw.
export function peekThemeName(css: string): string | null {
  const m = stripComments(css).match(/(?:^|[{;])\s*name\s*:\s*([^;]+)/);
  const name = m ? unquote(m[1].trim()) : "";
  return NAME_RE.test(name) ? name : null;
}
