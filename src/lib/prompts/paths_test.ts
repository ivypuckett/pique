import { assertEquals, assertThrows } from "@std/assert";
import { assertPromptName, promptPath, promptsDir } from "./paths.ts";

function withHome(home: string, fn: () => void): void {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
}

// pi auto-discovers <agentDir>/prompts, and here that discovery is the whole point.
Deno.test("prompts live in pi's agent dir, where pi looks for them", () => {
  withHome("/tmp/home", () => {
    assertEquals(promptsDir(), "/tmp/home/.pique/agent/prompts");
    assertEquals(promptPath("ship"), "/tmp/home/.pique/agent/prompts/ship.md");
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
    assertThrows(() => promptPath("../escape"));
  });
});
