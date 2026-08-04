import { assertEquals, assertThrows } from "@std/assert";
import {
  assertAutomatonName,
  automatonPath,
  automatonsDir,
  pendingDir,
  runPath,
  runsDir,
  sessionsDir,
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

// automatons/ lives OUTSIDE the scope's agent dir, unlike prompts/ — pi must never
// auto-discover these as agentDir content.
Deno.test("automatons live outside the scope's agent dir", () => {
  withHome("/tmp/home", () => {
    assertEquals(
      automatonsDir(ROOT),
      "/tmp/home/.pique/scopes/root/automatons",
    );
    assertEquals(
      pendingDir("ws-2"),
      "/tmp/home/.pique/scopes/ws-2/automatons/pending",
    );
    assertEquals(runsDir(ROOT), "/tmp/home/.pique/scopes/root/automatons/runs");
    assertEquals(
      sessionsDir(ROOT),
      "/tmp/home/.pique/scopes/root/automatons/sessions",
    );
  });
});

Deno.test("a name that could escape its directory is rejected", () => {
  assertThrows(() => assertAutomatonName("../evil"));
  assertThrows(() => assertAutomatonName("nested/name"));
  assertThrows(() => assertAutomatonName(""));
  assertThrows(() => assertAutomatonName("Triage"));
  assertAutomatonName("daily-triage");
  assertAutomatonName("r2");
});

Deno.test("path builders enforce the name rule", () => {
  withHome("/tmp/home", () => {
    assertThrows(() => automatonPath(ROOT, "../escape"));
  });
});

Deno.test("runPath rejects an id that isn't a plain token", () => {
  withHome("/tmp/home", () => {
    assertThrows(() => runPath(ROOT, "../escape"));
    assertThrows(() => runPath(ROOT, "not/a/path"));
    assertThrows(() => runPath(ROOT, "has.dot"));
    assertEquals(
      runPath(ROOT, "a1b2c3"),
      "/tmp/home/.pique/scopes/root/automatons/runs/a1b2c3.json",
    );
  });
});
