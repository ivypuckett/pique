// The subagent definition file format, and nothing else. Pure — no filesystem — so the
// format is testable on its own. Modeled on prompts/parse.ts: YAML frontmatter over a
// markdown body, the body being the child session's system prompt. An agent's identity
// is its filename stem (passed in as `name`), the same convention prompts use — the
// frontmatter carries no name of its own.
import { extract } from "@std/front-matter/yaml";

export type AgentDef = {
  name: string;
  description: string;
  // Comma-separated tool names in the frontmatter, split and trimmed. Absent means the
  // child gets pi's default base tools.
  tools?: string[];
  // A model id (or "provider/id"). Absent means the child inherits the parent
  // conversation's model.
  model?: string;
  systemPrompt: string;
  // Set when the frontmatter could not be used. The definition is still returned (with
  // its body as the system prompt) so a listing can show what is wrong instead of
  // silently dropping the file.
  error?: string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

function tools(v: unknown): string[] | undefined {
  if (typeof v !== "string") return undefined;
  const names = v.split(",").map((t) => t.trim()).filter(Boolean);
  return names.length > 0 ? names : undefined;
}

export function parseAgentDef(name: string, text: string): AgentDef {
  let attrs: Record<string, unknown> = {};
  let body = text;
  let error: string | undefined;
  try {
    // Throws on a file with no frontmatter, and on malformed YAML. The first is a
    // definition with no metadata at all; the second is worth surfacing, and the
    // opening `---` is what tells the two apart.
    const extracted = extract(text);
    attrs = extracted.attrs as Record<string, unknown>;
    body = extracted.body;
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      return {
        name,
        description: "",
        systemPrompt: text.trim(),
        error: `frontmatter: ${(err as Error).message}`,
      };
    }
  }
  return {
    name,
    description: str(attrs.description) ?? "",
    tools: tools(attrs.tools),
    model: str(attrs.model),
    systemPrompt: body.trim(),
    error,
  };
}

// Serialize back to the on-disk format. Frontmatter is emitted by hand rather than with
// a YAML writer, the same reasoning promptFile gives: the schema is narrow, and JSON's
// encoding of a string is valid YAML flow syntax, so a description holding `---` or a
// newline stays inside its quoted scalar.
export function agentFile(
  a: {
    description: string;
    tools?: string[];
    model?: string;
    systemPrompt: string;
  },
): string {
  const lines = [`description: ${JSON.stringify(a.description)}`];
  if (a.tools && a.tools.length > 0) {
    lines.push(`tools: ${JSON.stringify(a.tools.join(", "))}`);
  }
  if (a.model) lines.push(`model: ${JSON.stringify(a.model)}`);
  return `---\n${lines.join("\n")}\n---\n\n${a.systemPrompt.trim()}\n`;
}
