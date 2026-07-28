// The profile file format, and nothing else: frontmatter (a tool allowlist plus a
// description) over a markdown body that becomes appended system-prompt text. Pure —
// no filesystem, no pi — so the format is testable on its own.
import { extract } from "@std/front-matter/yaml";

// A type alias rather than an interface deliberately: only an alias gets TypeScript's
// implicit index signature, which is what lets a Profile cross the win.bind boundary
// (desktop.ts) as a JSON value.
export type Profile = {
  name: string;
  description?: string;
  // The tool allowlist. UNDEFINED and [] mean different things and must stay distinct:
  // undefined is "no allowlist" (pi's default set plus every extension and custom tool),
  // [] is "no tools at all". See docs/profiles.md.
  tools?: string[];
  // Rationale recorded by define_profile. Shown to the reviewer; never sent to a model,
  // which is why it lives here rather than in the body.
  rationale?: string;
  body: string;
  // Set when the frontmatter could not be used. The profile is still returned (with its
  // body) so the UI can show what is wrong instead of silently hiding the file.
  error?: string;
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function parseProfile(name: string, text: string): Profile {
  let attrs: Record<string, unknown> = {};
  let body = text;
  try {
    // Throws on a file with no frontmatter, and on malformed YAML. The first is normal
    // (a profile may be prompt text alone); the second is an error worth surfacing, and
    // the opening `---` is what tells the two apart.
    const extracted = extract(text);
    attrs = extracted.attrs as Record<string, unknown>;
    body = extracted.body;
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      return { name, body: text.trim(), error: `frontmatter: ${(err as Error).message}` };
    }
  }
  const raw = attrs.tools;
  const bad = raw !== undefined &&
    !(Array.isArray(raw) && raw.every((t) => typeof t === "string"));
  return {
    name,
    description: str(attrs.description),
    rationale: str(attrs.rationale),
    tools: bad ? undefined : (raw as string[] | undefined),
    body: body.trim(),
    error: bad ? "tools must be a list of tool names" : undefined,
  };
}
