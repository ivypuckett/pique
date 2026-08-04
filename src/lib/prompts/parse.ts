// The prompt template file format, and nothing else. Pure — no filesystem, no pi — so
// the format is testable on its own.
//
// The format is pi's, not pique's: `description` and `argument-hint` frontmatter over a
// markdown body, with the description falling back to the body's first line. This module
// exists to show a template in Library → Prompts the way pi will read it, so the two must agree —
// see prompts_pi_test.ts, which asserts that against the SDK's own loader.
import { extract } from "@std/front-matter/yaml";

// A type alias rather than an interface, so it keeps TypeScript's implicit index
// signature and can cross the win.bind boundary as a JSON value.
export type Prompt = {
  name: string;
  // pi always resolves a description: the frontmatter key, or the body's first line
  // truncated to 60 chars. Never undefined, so the UI and the `/` menu agree.
  description: string;
  // Shown in the `/` menu after the name, e.g. "<file-path>". pi reads this from the
  // `argument-hint` key; the camelCase name here mirrors pi's PromptTemplate field.
  argumentHint?: string;
  // Rationale recorded by define_prompt. Shown to the reviewer; never part of the
  // expanded prompt, which is why it lives here rather than in the body.
  rationale?: string;
  body: string;
  // Set when the frontmatter could not be used. The template is still returned (with its
  // body) so the UI can show what is wrong instead of silently hiding the file.
  error?: string;
};

const str = (
  v: unknown,
): string | undefined => (typeof v === "string" ? v : undefined);

// pi's fallback, reproduced exactly: the first non-empty line, truncated at 60 with an
// ellipsis. Diverging here would make Library → Prompts disagree with the `/` menu.
function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim());
  if (!line) return "";
  return line.length > 60 ? line.slice(0, 60) + "..." : line;
}

export function parsePrompt(name: string, text: string): Prompt {
  let attrs: Record<string, unknown> = {};
  let body = text;
  let error: string | undefined;
  try {
    // Throws on a file with no frontmatter, and on malformed YAML. The first is normal
    // (a template may be prompt text alone); the second is worth surfacing, and the
    // opening `---` is what tells the two apart.
    const extracted = extract(text);
    attrs = extracted.attrs as Record<string, unknown>;
    body = extracted.body;
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      // pi's own frontmatter parser is more forgiving than a YAML one, so a file that
      // fails here may still load for pi. Report it, but keep the whole text as the body
      // rather than pretending the file is empty.
      return {
        name,
        description: firstLine(text),
        body: text.trim(),
        error: `frontmatter: ${(err as Error).message}`,
      };
    }
  }
  return {
    name,
    description: str(attrs.description) ?? firstLine(body),
    argumentHint: str(attrs["argument-hint"]),
    rationale: str(attrs.rationale),
    body: body.trim(),
    error,
  };
}

// Serialize back to the on-disk format. Frontmatter is emitted by hand rather than with a
// YAML writer: the schema is three keys wide, and JSON's encoding of a string is valid
// YAML flow syntax — which is also what contains the text, so a description holding `---`
// or a newline stays inside its quoted scalar.
export function promptFile(
  p: {
    description: string;
    argumentHint?: string;
    rationale?: string;
    body: string;
  },
): string {
  const lines = [`description: ${JSON.stringify(p.description)}`];
  if (p.argumentHint) {
    lines.push(`argument-hint: ${JSON.stringify(p.argumentHint)}`);
  }
  if (p.rationale) lines.push(`rationale: ${JSON.stringify(p.rationale)}`);
  return `---\n${lines.join("\n")}\n---\n\n${p.body.trim()}\n`;
}
