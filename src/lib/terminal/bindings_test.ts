import { assertEquals } from "@std/assert";
import { terminalBindings } from "./bindings.ts";

Deno.test("terminalBindings returns null when the bridge is absent (browser/test)", () => {
  // In deno test there is no deno desktop window, so globalThis.bindings is undefined.
  assertEquals(terminalBindings(), null);
});
