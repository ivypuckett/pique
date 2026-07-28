import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseProfile } from "./parse.ts";

Deno.test("parses frontmatter and body", () => {
  const p = parseProfile(
    "reviewer",
    "---\ndescription: Reads only\ntools: [read, grep]\n---\n\nBe careful.\n",
  );
  assertEquals(p.name, "reviewer");
  assertEquals(p.description, "Reads only");
  assertEquals(p.tools, ["read", "grep"]);
  assertEquals(p.body, "Be careful.");
  assertEquals(p.error, undefined);
});

Deno.test("a file with no frontmatter is all body", () => {
  const p = parseProfile("plain", "Just prompt text.\n");
  assertEquals(p.tools, undefined);
  assertEquals(p.description, undefined);
  assertEquals(p.body, "Just prompt text.");
  assertEquals(p.error, undefined);
});

Deno.test("omitted tools and an empty list are different", () => {
  // The distinction the whole feature rests on: no allowlist vs an empty allowlist.
  assertEquals(parseProfile("a", "---\ndescription: x\n---\nbody").tools, undefined);
  assertEquals(parseProfile("b", "---\ntools: []\n---\nbody").tools, []);
});

Deno.test("malformed yaml is reported, not thrown", () => {
  const p = parseProfile("bad", "---\ntools: [a, b\n---\nbody");
  assertStringIncludes(p.error ?? "", "frontmatter");
});

Deno.test("a non-list tools value is reported", () => {
  const p = parseProfile("bad", "---\ntools: read\n---\nbody");
  assertStringIncludes(p.error ?? "", "list of tool names");
  assertEquals(p.tools, undefined);
});

Deno.test("a list holding a non-string is reported", () => {
  assertStringIncludes(parseProfile("bad", "---\ntools: [read, 7]\n---\nbody").error ?? "", "list");
});

Deno.test("unknown keys are ignored", () => {
  const p = parseProfile("x", "---\nfuture: 1\ndescription: d\n---\nbody");
  assertEquals(p.body, "body");
  assertEquals(p.description, "d");
});

Deno.test("the rationale is read from frontmatter, never from the body", () => {
  const p = parseProfile("x", "---\nrationale: user asked for it\n---\nbody");
  assertEquals(p.rationale, "user asked for it");
  assertEquals(p.body, "body");
});

Deno.test("an empty body is preserved as empty, not as whitespace", () => {
  assertEquals(parseProfile("x", "---\ntools: [read]\n---\n\n").body, "");
});
