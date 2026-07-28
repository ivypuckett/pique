import { assertEquals, assertThrows } from "@std/assert";
import {
  assertProfileName,
  basePromptPath,
  pendingDir,
  pendingProfilePath,
  profilePath,
  profilesDir,
} from "./paths.ts";
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

Deno.test("profiles live beside the agent dir, with quarantine nested inside", () => {
  withHome("/home/x", () => {
    const base = "/home/x/.pique/scopes/ws-1/profiles";
    assertEquals(profilesDir("ws-1"), base);
    assertEquals(pendingDir("ws-1"), `${base}/pending`);
    assertEquals(profilePath("ws-1", "reviewer"), `${base}/reviewer.md`);
    assertEquals(pendingProfilePath("ws-1", "reviewer"), `${base}/pending/reviewer.md`);
  });
});

Deno.test("profiles are not inside the agent dir pi discovers", () => {
  withHome("/home/x", () => {
    assertEquals(profilesDir(ROOT).includes("/agent"), false);
  });
});

Deno.test("the base prompt uses pi's own filename inside the agent dir", () => {
  withHome("/home/x", () => {
    assertEquals(basePromptPath(ROOT), "/home/x/.pique/scopes/root/agent/SYSTEM.md");
    assertEquals(basePromptPath("ws-2"), "/home/x/.pique/scopes/ws-2/agent/SYSTEM.md");
  });
});

Deno.test("each scope gets its own profiles dir", () => {
  withHome("/home/x", () => {
    assertEquals(profilesDir(ROOT), "/home/x/.pique/scopes/root/profiles");
    assertEquals(profilesDir("ws-2"), "/home/x/.pique/scopes/ws-2/profiles");
  });
});

Deno.test("profile names cannot escape their directory", () => {
  for (const bad of ["../evil", "a/b", "/abs", "", ".", "Reviewer", "-lead", "sp ace", "a_b"]) {
    assertThrows(() => assertProfileName(bad), Error, "invalid profile name");
  }
});

Deno.test("profile names accept lowercase kebab-case", () => {
  for (const ok of ["a", "reviewer", "code-reviewer", "plan9", "a-b-c"]) assertProfileName(ok);
});

Deno.test("a bad scope id is refused before it reaches the filesystem", () => {
  withHome("/home/x", () => {
    assertThrows(() => profilesDir("../evil"), Error, "invalid scope id");
    assertThrows(() => profilePath("a/b", "reviewer"), Error, "invalid scope id");
  });
});
