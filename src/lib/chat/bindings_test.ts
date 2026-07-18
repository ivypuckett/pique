import { assertEquals } from "@std/assert";
import { chatBindings } from "./bindings.ts";

Deno.test("chatBindings returns null when the bridge is absent (browser/test)", () => {
  assertEquals(chatBindings(), null);
});
