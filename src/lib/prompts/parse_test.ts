import { assertEquals } from "@std/assert";
import { parsePrompt, promptFile } from "./parse.ts";

Deno.test("frontmatter supplies the description and the argument hint", () => {
  const p = parsePrompt(
    "review",
    '---\ndescription: Review staged changes\nargument-hint: "<file-path>"\n---\nReview $1\n',
  );
  assertEquals(p.description, "Review staged changes");
  assertEquals(p.argumentHint, "<file-path>");
  assertEquals(p.body, "Review $1");
  assertEquals(p.error, undefined);
});

Deno.test("a template with no frontmatter is prompt text alone, not an error", () => {
  const p = parsePrompt("hello", "Say hello to $1\n");
  assertEquals(p.body, "Say hello to $1");
  assertEquals(p.error, undefined);
});

// pi falls back to the body's first line, truncated at 60 with an ellipsis. The
// the Library module list and the `/` menu read the same file through different parsers,
// so this reproduces pi's rule exactly rather than approximating it.
Deno.test("a missing description falls back to the first line, truncated at 60", () => {
  assertEquals(
    parsePrompt("a", "\n\nfirst line\nsecond line").description,
    "first line",
  );
  const long = "x".repeat(75);
  assertEquals(parsePrompt("b", long).description, "x".repeat(60) + "...");
});

Deno.test("malformed frontmatter is reported and the file is still readable", () => {
  const p = parsePrompt("bad", "---\ndescription: [unclosed\n---\nbody");
  assertEquals(p.error?.startsWith("frontmatter:"), true);
  assertEquals(p.body.includes("body"), true);
});

Deno.test("promptFile round-trips through parsePrompt", () => {
  const text = promptFile({
    description: "Ship it",
    argumentHint: "<pr>",
    rationale: "asked for often",
    body: "Merge $1",
  });
  const p = parsePrompt("ship", text);
  assertEquals(p.description, "Ship it");
  assertEquals(p.argumentHint, "<pr>");
  assertEquals(p.rationale, "asked for often");
  assertEquals(p.body, "Merge $1");
});

// The reason the frontmatter is JSON-encoded: a description holding `---` or a newline
// has to stay inside its quoted scalar instead of ending the block.
Deno.test("a description containing --- or a newline stays in the frontmatter", () => {
  const text = promptFile({ description: "a\n---\nb", body: "body" });
  const p = parsePrompt("x", text);
  assertEquals(p.description, "a\n---\nb");
  assertEquals(p.body, "body");
});

// An empty hint must be omitted rather than written as "", or the `/` menu renders a
// stray gap after the name.
Deno.test("an absent hint or rationale is left out of the file", () => {
  assertEquals(
    promptFile({ description: "d", body: "b" }).includes("argument-hint"),
    false,
  );
  assertEquals(
    promptFile({ description: "d", body: "b" }).includes("rationale"),
    false,
  );
});
