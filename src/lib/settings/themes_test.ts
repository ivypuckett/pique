import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  deleteTheme,
  duplicateCss,
  restoreDefaults,
  saveTheme,
  seedThemes,
  themesFromStored,
  themesStyleText,
  type StoredTheme,
} from "./themes.ts";
import { DEFAULT_SETTINGS } from "./bindings.ts";
import { parseThemeCss } from "./theme_css.ts";

const css = (name: string) =>
  `@plugin "daisyui/theme" {\n  name: "${name}";\n  --color-primary: red;\n}`;
const list = (...names: string[]): StoredTheme[] =>
  names.map((n) => ({ name: n, css: css(n) }));

Deno.test("seeds carry every theme pique ships, in picker order", () => {
  const seeds = seedThemes();
  assertEquals(seeds.map((t) => t.name), [
    "catppuccin-frappe",
    "amoled",
    "dark",
    "light",
    "dracula",
    "nord",
  ]);
});

Deno.test("the default theme setting names a seeded theme", () => {
  // A default naming a theme nobody seeds would leave a fresh install unthemed.
  assert(seedThemes().some((t) => t.name === DEFAULT_SETTINGS.appearance.theme));
});

Deno.test("saving a new theme appends it", () => {
  const next = saveTheme(list("a", "b"), null, css("c"));
  assertEquals(next.map((t) => t.name), ["a", "b", "c"]);
});

Deno.test("saving an edit keeps the theme in place", () => {
  const edited = `@plugin "daisyui/theme" {\n  name: "b";\n  --color-primary: blue;\n}`;
  const next = saveTheme(list("a", "b", "c"), "b", edited);
  assertEquals(next.map((t) => t.name), ["a", "b", "c"]);
  assertEquals(next[1].css, edited);
});

Deno.test("a rename stays in place and takes the new name", () => {
  const next = saveTheme(list("a", "b", "c"), "b", css("bee"));
  assertEquals(next.map((t) => t.name), ["a", "bee", "c"]);
});

Deno.test("a name collision is rejected rather than shadowing the existing theme", () => {
  // The daisyui generator happily exports a theme named "light"; pasting one when a
  // "light" already exists must point at that theme, not quietly replace it.
  assertThrows(
    () => saveTheme(list("light", "dark"), null, css("light")),
    Error,
    `a theme named "light" already exists`,
  );
  // Renaming onto another theme's name collides too.
  assertThrows(() => saveTheme(list("light", "dark"), "dark", css("light")), Error);
});

Deno.test("saving a theme under its own name is not a collision", () => {
  const next = saveTheme(list("light"), "light", css("light"));
  assertEquals(next.length, 1);
});

Deno.test("saving rejects text that would not make a theme", () => {
  assertThrows(() => saveTheme(list("a"), null, `name: "b";`), Error);
});

Deno.test("deleting removes just that theme", () => {
  assertEquals(deleteTheme(list("a", "b"), "a").map((t) => t.name), ["b"]);
});

Deno.test("restoring defaults reverts an edited seed and brings a deleted one back", () => {
  const seeds = seedThemes();
  const mangled = seeds
    .filter((t) => t.name !== "nord")
    .map((t) => (t.name === "dark" ? { name: t.name, css: css("dark") } : t));
  assertEquals(restoreDefaults(mangled), seeds);
});

Deno.test("restoring defaults keeps the user's own themes, after the seeds", () => {
  const mine = list("mine", "also-mine");
  const next = restoreDefaults([mine[0], ...seedThemes(), mine[1]]);
  assertEquals(next.map((t) => t.name), [
    ...seedThemes().map((t) => t.name),
    "mine",
    "also-mine",
  ]);
  // A theme the user wrote is carried across untouched, not re-derived.
  assertEquals(next.at(-2), mine[0]);
});

Deno.test("the last theme cannot be deleted", () => {
  assertThrows(() => deleteTheme(list("a"), "a"), Error, "only theme left");
});

Deno.test("a duplicate is renamed text, not a saved theme", () => {
  const copy = duplicateCss(list("nord"), "nord");
  assertEquals(parseThemeCss(copy).name, "nord-copy");
  assertEquals(parseThemeCss(copy).vars, parseThemeCss(css("nord")).vars);
});

Deno.test("a duplicate avoids the name of an existing copy", () => {
  const saved = saveTheme(list("nord"), null, duplicateCss(list("nord"), "nord"));
  assertEquals(parseThemeCss(duplicateCss(saved, "nord")).name, "nord-copy-2");
});

Deno.test("duplicating a seeded theme keeps its comments", () => {
  assert(duplicateCss(seedThemes(), "catppuccin-frappe").includes("/* mantle */"));
});

Deno.test("style text carries one rule per theme", () => {
  const text = themesStyleText(seedThemes());
  assertEquals(text.match(/\[data-theme=/g)?.length, 6);
  assert(text.includes(`[data-theme="amoled"]`));
  assert(text.includes("--color-base-100: #000000;"));
});

Deno.test("a theme that does not parse costs only itself", () => {
  const text = themesStyleText([...list("good"), { name: "bad", css: "{{{" }]);
  assert(text.includes(`[data-theme="good"]`));
  assert(!text.includes("bad"));
});

Deno.test("stored themes are rejected when the file is not a usable list", () => {
  assertEquals(themesFromStored(null), null);
  assertEquals(themesFromStored([]), null);
  assertEquals(themesFromStored([{ name: "a" }]), null);
  assertEquals(themesFromStored("nord"), null);
  assertEquals(themesFromStored([{ name: "a", css: css("a") }])?.length, 1);
});
