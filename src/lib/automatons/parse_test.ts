import { assertEquals } from "@std/assert";
import { automatonFile, parseAutomaton } from "./parse.ts";

Deno.test("a full file parses into its four references", () => {
  const a = parseAutomaton(
    "triage",
    `---
description: Sorts new cards.
prompt: daily-triage
extensions: [pique:kanban, kanban_notes]
skills: [changelog-style]
---
`,
  );
  assertEquals(a.name, "triage");
  assertEquals(a.description, "Sorts new cards.");
  assertEquals(a.prompt, "daily-triage");
  assertEquals(a.extensions, ["pique:kanban", "kanban_notes"]);
  assertEquals(a.skills, ["changelog-style"]);
  assertEquals(a.error, undefined);
});

// Decision 2: absent lists are empty, and an empty list is a real, honoured value —
// it means "no extensions", not "the defaults".
Deno.test("absent extensions and skills default to empty", () => {
  const a = parseAutomaton("triage", "---\nprompt: p\n---\n");
  assertEquals(a.extensions, []);
  assertEquals(a.skills, []);
  assertEquals(a.description, "");
});

Deno.test("a missing prompt is an error, not a default", () => {
  const a = parseAutomaton("triage", "---\ndescription: d\n---\n");
  assertEquals(a.prompt, "");
  assertEquals(a.error, "prompt: required");
});

Deno.test("a file with no frontmatter at all is an error", () => {
  const a = parseAutomaton("triage", "just some text\n");
  assertEquals(a.error, "prompt: required");
});

Deno.test("malformed frontmatter is reported rather than silently ignored", () => {
  const a = parseAutomaton("triage", "---\nprompt: [unclosed\n---\n");
  assertEquals(a.prompt, "");
  assertEquals(a.error?.startsWith("frontmatter: "), true);
});

// Decision 2: the body is reserved. It is retained so nothing is lost on a
// round-trip, and it is never interpreted as prompt text.
Deno.test("the body is retained but is not the prompt", () => {
  const a = parseAutomaton("triage", "---\nprompt: p\n---\nsome notes\n");
  assertEquals(a.body, "some notes");
  assertEquals(a.prompt, "p");
});

Deno.test("non-string list entries are dropped rather than coerced", () => {
  const a = parseAutomaton(
    "triage",
    "---\nprompt: p\nextensions: [ok, 3, null]\n---\n",
  );
  assertEquals(a.extensions, ["ok"]);
});

Deno.test("unknown keys are ignored", () => {
  const a = parseAutomaton("triage", "---\nprompt: p\nmystery: 1\n---\n");
  assertEquals(a.prompt, "p");
  assertEquals(a.error, undefined);
});

Deno.test("automatonFile round-trips through parseAutomaton", () => {
  const text = automatonFile({
    description: 'has "quotes" and, commas',
    prompt: "daily-triage",
    extensions: ["pique:kanban"],
    skills: [],
  });
  const a = parseAutomaton("triage", text);
  assertEquals(a.description, 'has "quotes" and, commas');
  assertEquals(a.prompt, "daily-triage");
  assertEquals(a.extensions, ["pique:kanban"]);
  assertEquals(a.skills, []);
});
