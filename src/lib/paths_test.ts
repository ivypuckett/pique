import { assertEquals, assertThrows } from "@std/assert";
import { agentDir, assertId, piqueDir, viewSessionsDir } from "./paths.ts";

function withHome(home: string, fn: () => void): void {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
}

// pi's own agent dir, so pique and the `pi` CLI find the same extensions, templates,
// skills and prompt files.
Deno.test("the agent dir is pi's, and pique's own state is beside it", () => {
  withHome("/home/x", () => {
    assertEquals(agentDir(), "/home/x/.pi/agent");
    assertEquals(piqueDir(), "/home/x/.pique");
  });
});

Deno.test("each view keeps its conversations in a directory of its own", () => {
  withHome("/home/x", () => {
    assertEquals(
      viewSessionsDir("ws-1", "view-2"),
      "/home/x/.pique/sessions/ws-1/view-2",
    );
  });
});

// Resolving these is what boot depends on — on Windows, off USERPROFILE. The mixed
// separators below are current behaviour, not endorsed: Windows accepts "/" on input,
// and joining is a separate sweep.
Deno.test("paths resolve off USERPROFILE where HOME is unset", () => {
  const prev = Deno.env.get("HOME");
  Deno.env.delete("HOME");
  Deno.env.set("USERPROFILE", "C:\\Users\\x");
  try {
    assertEquals(agentDir(), "C:\\Users\\x/.pi/agent");
  } finally {
    Deno.env.delete("USERPROFILE");
    if (prev) Deno.env.set("HOME", prev);
  }
});

Deno.test("an id that could escape its directory is refused", () => {
  for (const bad of ["../x", "a/b", "", "-x", "WS"]) {
    assertThrows(() => assertId(bad), Error, undefined, bad);
  }
  assertThrows(() => viewSessionsDir("ws-1", "../x"));
  assertId("ws-1");
  assertId("view-12");
});
