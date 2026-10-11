import { assertEquals, assertThrows } from "@std/assert";
import {
  agentDir,
  assertId,
  configureAgentDir,
  piAgentDir,
  piqueDir,
  viewSessionsDir,
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

// Everything under ~/.pique, with pi's agent dir laid out inside it — and the `pi`
// CLI's own dir apart, as what an import copies from.
Deno.test("the agent dir is inside ~/.pique, apart from pi's own", () => {
  withHome("/home/x", () => {
    assertEquals(piqueDir(), "/home/x/.pique");
    assertEquals(agentDir(), "/home/x/.pique/agent");
    assertEquals(piAgentDir(), "/home/x/.pi/agent");
  });
});

// The setting moves it, and a blank one is the default; either way pi is told, so an
// extension asking pi for its dir gets the same answer.
Deno.test("the agent dir can be moved, and pi is told where", () => {
  const prev = Deno.env.get("PI_CODING_AGENT_DIR");
  try {
    withHome("/home/x", () => {
      configureAgentDir("/home/x/.pi/agent");
      assertEquals(agentDir(), "/home/x/.pi/agent");
      assertEquals(Deno.env.get("PI_CODING_AGENT_DIR"), "/home/x/.pi/agent");
      configureAgentDir("  ");
      assertEquals(agentDir(), "/home/x/.pique/agent");
      assertEquals(Deno.env.get("PI_CODING_AGENT_DIR"), "/home/x/.pique/agent");
    });
  } finally {
    configureAgentDir(undefined);
    if (prev === undefined) Deno.env.delete("PI_CODING_AGENT_DIR");
    else Deno.env.set("PI_CODING_AGENT_DIR", prev);
  }
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
    assertEquals(agentDir(), "C:\\Users\\x/.pique/agent");
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
