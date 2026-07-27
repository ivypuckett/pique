import { assertEquals, assertThrows } from "@std/assert";
import { assertToolName, liveDir, livePath, pendingDir, pendingPath } from "./paths.ts";

function withHome(home: string, fn: () => void): void {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
}

Deno.test("live and pending are separate dirs under the pi agent dir", () => {
  withHome("/home/x", () => {
    assertEquals(liveDir(), "/home/x/.pique/agent/extensions");
    assertEquals(pendingDir(), "/home/x/.pique/agent/pending");
    assertEquals(livePath("my_tool"), "/home/x/.pique/agent/extensions/my_tool.ts");
    assertEquals(pendingPath("my_tool"), "/home/x/.pique/agent/pending/my_tool.ts");
  });
});

Deno.test("tool names cannot escape their directory", () => {
  for (const bad of ["../evil", "a/b", "/abs", "", ".", "Upper", "9lead", "has-dash", "sp ace"]) {
    assertThrows(() => assertToolName(bad), Error, "invalid tool name");
  }
});

Deno.test("tool names accept lowercase identifiers", () => {
  for (const ok of ["a", "lookup_weather", "tool9", "a_b_c"]) assertToolName(ok);
});
