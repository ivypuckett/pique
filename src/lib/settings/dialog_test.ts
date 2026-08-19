import { assertEquals, assertThrows } from "@std/assert";
import { openUrlCommand } from "./dialog.ts";

Deno.test("openUrlCommand uses the platform opener", () => {
  const url = "https://daisyui.com/theme-generator";
  assertEquals(openUrlCommand("linux", url), { cmd: "xdg-open", args: [url] });
  assertEquals(openUrlCommand("darwin", url), { cmd: "open", args: [url] });
});

Deno.test("openUrlCommand refuses anything but https", () => {
  // The opener acts on whatever scheme the desktop knows — file://, and worse.
  assertThrows(() => openUrlCommand("linux", "file:///etc/passwd"), Error, "not an https");
  assertThrows(() => openUrlCommand("linux", "http://daisyui.com"), Error, "not an https");
});
