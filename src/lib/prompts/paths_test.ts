import { assertEquals, assertThrows } from "@std/assert";
import {
  assertPromptName,
  pendingDir,
  pendingPromptPath,
  promptPath,
  promptsDir,
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

// The live dir is INSIDE the scope's agentDir: pi auto-discovers <agentDir>/prompts,
// and here that discovery is the whole point.
Deno.test("prompts live in the scope's agent dir, where pi looks for them", () => {
  withHome("/tmp/home", () => {
    assertEquals(
      promptsDir(ROOT),
      "/tmp/home/.pique/scopes/root/agent/prompts",
    );
    assertEquals(
      pendingDir("ws-2"),
      "/tmp/home/.pique/scopes/ws-2/agent/prompts/pending",
    );
  });
});

Deno.test("a name that could escape its directory is rejected", () => {
  assertThrows(() => assertPromptName("../evil"));
  assertThrows(() => assertPromptName("nested/name"));
  assertThrows(() => assertPromptName("-leading-dash"));
  assertThrows(() => assertPromptName(""));
  assertPromptName("review-staged");
  assertPromptName("r2");
});

Deno.test("path builders enforce the name rule", () => {
  withHome("/tmp/home", () => {
    assertThrows(() => promptPath(ROOT, "../escape"));
    assertThrows(() => pendingPromptPath(ROOT, "../escape"));
  });
});
