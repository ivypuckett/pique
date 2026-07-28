import { assertEquals, assertThrows } from "@std/assert";
import { assertToolName, liveDir, livePath, pendingDir, pendingPath } from "./paths.ts";
import { ROOT } from "../scope/paths.ts";

function withHome(home: string, fn: () => void): void {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
}

Deno.test("live and pending are separate dirs inside the scope's agent dir", () => {
  withHome("/home/x", () => {
    const base = "/home/x/.pique/scopes/ws-1/agent";
    assertEquals(liveDir("ws-1"), `${base}/extensions`);
    assertEquals(pendingDir("ws-1"), `${base}/pending`);
    assertEquals(livePath("ws-1", "my_tool"), `${base}/extensions/my_tool.ts`);
    assertEquals(pendingPath("ws-1", "my_tool"), `${base}/pending/my_tool.ts`);
  });
});

Deno.test("each scope gets its own pair of dirs", () => {
  withHome("/home/x", () => {
    assertEquals(liveDir(ROOT), "/home/x/.pique/scopes/root/agent/extensions");
    assertEquals(liveDir("ws-2"), "/home/x/.pique/scopes/ws-2/agent/extensions");
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

Deno.test("a bad scope id is refused before it reaches the filesystem", () => {
  withHome("/home/x", () => {
    assertThrows(() => liveDir("../evil"), Error, "invalid scope id");
    assertThrows(() => pendingPath("a/b", "ok_name"), Error, "invalid scope id");
  });
});
