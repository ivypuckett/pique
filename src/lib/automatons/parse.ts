// The automaton file format, and nothing else. Pure — no filesystem, no pi — so the
// format is testable on its own. Shaped on prompts/parse.ts.
//
// An automaton is four references: a prompt template to send, the extensions and
// skills the run may load, and a description for the human reading the list. The BODY
// IS RESERVED: it is retained so a round-trip loses nothing, and it is never sent to a
// model. `prompt:` is what runs (docs/automatons.md).
import { extract } from "@std/front-matter/yaml";

// A type alias rather than an interface, so it keeps TypeScript's implicit index
// signature and can cross the win.bind boundary as a JSON value.
export type Automaton = {
  name: string;
  description: string;
  // The prompt template this sends. Required; "" only when `error` is set.
  prompt: string;
  extensions: string[];
  skills: string[];
  // Reserved. Never interpreted; see the module comment.
  body: string;
  // Set when the file cannot be launched as written. The automaton is still returned
  // so the UI can show what is wrong instead of hiding the file.
  error?: string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

// A list of strings, dropping anything else. A YAML list holding a number is a typo,
// not an instruction, and coercing it would invent a reference nobody wrote.
function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((e): e is string => typeof e === "string")
    : [];
}

export function parseAutomaton(name: string, text: string): Automaton {
  const empty = {
    name,
    description: "",
    prompt: "",
    extensions: [],
    skills: [],
  };
  let attrs: Record<string, unknown> = {};
  let body = text;
  try {
    // Throws on a file with no frontmatter, and on malformed YAML. Unlike a prompt
    // template — which is legitimately body-only — an automaton with no frontmatter
    // carries no `prompt:` and so cannot run either way; the distinction only changes
    // which error the UI shows.
    const extracted = extract(text);
    attrs = extracted.attrs as Record<string, unknown>;
    body = extracted.body;
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      return {
        ...empty,
        body: text.trim(),
        error: `frontmatter: ${(err as Error).message}`,
      };
    }
    return { ...empty, body: text.trim(), error: "prompt: required" };
  }
  const prompt = str(attrs.prompt) ?? "";
  return {
    name,
    description: str(attrs.description) ?? "",
    prompt,
    extensions: strList(attrs.extensions),
    skills: strList(attrs.skills),
    body: body.trim(),
    error: prompt ? undefined : "prompt: required",
  };
}

// Serialize back to the on-disk format. Frontmatter is emitted by hand rather than
// with a YAML writer, as prompts/parse.ts does: the schema is four keys wide, and
// JSON's encoding of a string is valid YAML flow syntax — which is what keeps a
// description holding `---` or a newline inside its quoted scalar.
//
// The body is not written. It is reserved (see the module comment), and the editor
// has no field for it, so emitting one would create content nothing can edit.
export function automatonFile(
  a: {
    description: string;
    prompt: string;
    extensions: string[];
    skills: string[];
  },
): string {
  const list = (xs: string[]) =>
    `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  return [
    "---",
    `description: ${JSON.stringify(a.description)}`,
    `prompt: ${JSON.stringify(a.prompt)}`,
    `extensions: ${list(a.extensions)}`,
    `skills: ${list(a.skills)}`,
    "---",
    "",
  ].join("\n");
}
