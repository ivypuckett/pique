import { assertEquals } from "@std/assert";
import { isDarkColor } from "./theme.ts";

Deno.test("isDarkColor classifies rgb backgrounds", () => {
  assertEquals(isDarkColor("rgb(0, 0, 0)"), true);
  assertEquals(isDarkColor("rgb(48, 52, 70)"), true); // catppuccin-frappe base
  assertEquals(isDarkColor("rgb(255, 255, 255)"), false);
  assertEquals(isDarkColor("rgb(240, 240, 240)"), false);
});

Deno.test("isDarkColor classifies oklch/oklab backgrounds by lightness", () => {
  assertEquals(isDarkColor("oklch(1 0 0)"), false); // daisyui light base
  assertEquals(isDarkColor("oklch(0.95127 0.007 260.731)"), false); // nord base
  assertEquals(isDarkColor("oklch(0.28822 0.022 277.508)"), true); // dracula base
  assertEquals(isDarkColor("oklab(0.2 0 0)"), true);
});

Deno.test("isDarkColor falls back to dark on an unreadable value", () => {
  assertEquals(isDarkColor(""), true);
  assertEquals(isDarkColor("not-a-color"), true);
});
