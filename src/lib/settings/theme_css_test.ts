import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  formatThemeCss,
  parseThemeCss,
  parseThemeSheet,
  peekThemeName,
  splitThemeSheet,
  themeRule,
} from "./theme_css.ts";
import { SEED_THEMES } from "./seeds.ts";

// Pasted unedited out of daisyui's theme generator — the case the format exists for.
const GENERATED = `@plugin "daisyui/theme" {
  name: "light";
  default: false;
  prefersdark: false;
  color-scheme: "light";
  --color-base-100: oklch(0% 0 0);
  --color-base-content: #eee;
  --color-primary: oklch(89% 0.061 343.231);
  --radius-selector: 0.5rem;
  --border: 1px;
  --depth: 1;
  --noise: 0;
}`;

Deno.test("parses a daisyui theme generator export", () => {
  const t = parseThemeCss(GENERATED);
  assertEquals(t.name, "light");
  assertEquals(t.colorScheme, "light");
  assertEquals(t.default, false);
  assertEquals(t.prefersdark, false);
  assertEquals(t.vars.length, 7);
  assertEquals(t.vars[0], { name: "--color-base-100", value: "oklch(0% 0 0)" });
  assertEquals(t.vars[1], { name: "--color-base-content", value: "#eee" });
});

Deno.test("emits a rule daisyui's components can read", () => {
  const rule = themeRule(parseThemeCss(GENERATED));
  assert(rule.startsWith(`[data-theme="light"] {`));
  assert(rule.includes("color-scheme: light;"));
  assert(rule.includes("--color-primary: oklch(89% 0.061 343.231);"));
  // The generator's inert settings are not declarations; they must not leak into CSS.
  assert(!rule.includes("prefersdark"));
  assert(!rule.includes("name:"));
});

Deno.test("round-trips through the daisyui block format", () => {
  const once = formatThemeCss(parseThemeCss(GENERATED));
  assertEquals(formatThemeCss(parseThemeCss(once)), once);
  assertEquals(parseThemeCss(once).vars, parseThemeCss(GENERATED).vars);
});

Deno.test("declaration order survives a round trip", () => {
  const css = `@plugin "daisyui/theme" {
    name: "x";
    --noise: 0;
    --color-primary: red;
    --border: 2px;
  }`;
  assertEquals(parseThemeCss(css).vars.map((v) => v.name), [
    "--noise",
    "--color-primary",
    "--border",
  ]);
});

Deno.test("comments are ignored, including trailing notes on a value", () => {
  const t = parseThemeCss(`@plugin "daisyui/theme" {
    name: "x";
    --color-base-100: #303446; /* base */
    /* --color-primary: #000; */
  }`);
  assertEquals(t.vars, [{ name: "--color-base-100", value: "#303446" }]);
});

Deno.test("tolerates a body pasted without its @plugin wrapper", () => {
  const t = parseThemeCss(`name: "x"; --color-primary: red;`);
  assertEquals(t.name, "x");
  assertEquals(t.vars.length, 1);
});

Deno.test("rejects a theme with no name", () => {
  assertThrows(
    () => parseThemeCss(`@plugin "daisyui/theme" { --color-primary: red; }`),
    Error,
    "missing a name",
  );
});

Deno.test("rejects a name that would not survive a CSS selector", () => {
  assertThrows(
    () => parseThemeCss(`name: "my theme"; --color-primary: red;`),
    Error,
    "invalid name",
  );
});

Deno.test("rejects a theme with no custom properties", () => {
  assertThrows(
    () => parseThemeCss(`name: "x"; color-scheme: "dark";`),
    Error,
    "no --custom-properties",
  );
});

Deno.test("rejects an unknown setting by name", () => {
  assertThrows(
    () => parseThemeCss(`name: "x"; prefersDark: true; --color-primary: red;`),
    Error,
    `unknown setting "prefersDark"`,
  );
});

Deno.test("rejects a value that could break out of its declaration", () => {
  // Injected into the app's own stylesheet, so a value carrying braces or an at-rule
  // must not be able to close the rule and open something else.
  assertThrows(
    () =>
      parseThemeCss(
        `@plugin "daisyui/theme" { name: "x"; --c: red} body{display:none; }`,
      ),
    Error,
    "invalid value",
  );
  assertThrows(
    () => parseThemeCss(`name: "x"; --x: y; --z: @import "http://evil";`),
    Error,
  );
});

Deno.test("rejects a property that is not a custom property", () => {
  assertThrows(
    () => parseThemeCss(`name: "x"; background: url(http://tracker);`),
    Error,
    "unknown setting",
  );
});

Deno.test("peekThemeName reads a name from unfinished text", () => {
  assertEquals(peekThemeName(`@plugin "daisyui/theme" {\n  name: "nord";\n  --c`), "nord");
  assertEquals(peekThemeName(`@plugin "daisyui/theme" {`), null);
  assertEquals(peekThemeName(`name: "not a name";`), null);
});

Deno.test("splits a sheet into one block per theme", () => {
  const blocks = splitThemeSheet(SEED_THEMES);
  assertEquals(blocks.length, 6);
  assert(blocks.every((b) => b.startsWith("@plugin")));
});

Deno.test("every seeded theme parses and has unique name", () => {
  const seeds = parseThemeSheet(SEED_THEMES);
  assertEquals(seeds.map((t) => t.name), [
    "catppuccin-frappe",
    "amoled",
    "dark",
    "light",
    "dracula",
    "nord",
  ]);
  // Each carries daisyui's full token set — 20 colors, 3 radii, 2 sizes, border,
  // depth, noise. A short one means the copy dropped something.
  for (const t of seeds) {
    assert(t.vars.length >= 28, `${t.name} has only ${t.vars.length} properties`);
    assert(t.colorScheme === "light" || t.colorScheme === "dark", t.name);
    assert(t.vars.some((v) => v.name === "--color-base-100"), t.name);
  }
});
