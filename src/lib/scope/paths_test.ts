import { assertEquals, assertThrows } from "@std/assert";
import {
  assertScopeId,
  chain,
  ROOT,
  scopeAgentDir,
  scopeBoardPath,
  scopeConfigPath,
  scopeDir,
} from "./paths.ts";

function withHome(home: string, fn: () => void): void {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
}

Deno.test("a scope owns one directory holding its agent dir, config and board", () => {
  withHome("/home/x", () => {
    assertEquals(scopeDir("ws-1"), "/home/x/.pique/scopes/ws-1");
    assertEquals(scopeAgentDir("ws-1"), "/home/x/.pique/scopes/ws-1/agent");
    assertEquals(scopeConfigPath("ws-1"), "/home/x/.pique/scopes/ws-1/config.json");
    assertEquals(scopeBoardPath("ws-1"), "/home/x/.pique/scopes/ws-1/board.db");
    assertEquals(scopeAgentDir(ROOT), "/home/x/.pique/scopes/root/agent");
  });
});

Deno.test("a workspace inherits from root, root from nothing", () => {
  assertEquals(chain("ws-1"), ["root", "ws-1"]);
  assertEquals(chain(ROOT), ["root"]);
});

Deno.test("the chain orders ancestors first so the nearest scope wins", () => {
  const c = chain("ws-2");
  assertEquals(c[0], ROOT);
  assertEquals(c[c.length - 1], "ws-2");
});

Deno.test("scope ids cannot escape the scopes directory", () => {
  for (const bad of ["../evil", "a/b", "/abs", "", ".", "Upper", "-lead", "under_score"]) {
    assertThrows(() => assertScopeId(bad), Error, "invalid scope id");
    assertThrows(() => chain(bad), Error, "invalid scope id");
  }
});

Deno.test("scope ids accept root and workspace slugs", () => {
  for (const ok of ["root", "ws-1", "ws-42"]) assertScopeId(ok);
});
