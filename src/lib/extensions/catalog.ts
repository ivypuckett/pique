// The catalog's own vocabulary: what a pi package can CONTAIN, and how to read that off
// an npm record. Pure — no fetching, no Deno APIs — because both halves need it: the
// backend (packages.ts) to build its queries, and the Library shell to render the facet
// chips. packages.ts imports pi's DefaultPackageManager and so cannot be bundled for the
// browser at all, which is why this is its own module rather than part of it.

export type PackageType = "extension" | "skill" | "prompt" | "theme";

export const PACKAGE_TYPES: PackageType[] = [
  "extension",
  "skill",
  "prompt",
  "theme",
];

// How pi.dev/packages types its cards: exact npm keyword tokens, not substrings.
// Verified 2026-08-08 against every package pi.dev lists under ?type=extension|skill|
// prompt|theme (479 in all) — this table reproduces its badges exactly. Substring
// matching would be wrong in both directions: `agent-extensions` and `red-skills` are
// keywords pi.dev does NOT type, while `prompt-template` is one it does.
//
// NOT read from package.json's `pi` field, which would seem more authoritative and is
// not: pi-subagents declares extensions, prompts AND skills there, and pi.dev types it
// as none of them.
//
// Every token here is also one query in the type-filter fan-out (packages.ts), so a
// token no package uses is a wasted request — each was checked to return hits.
export const TYPE_KEYWORDS: Record<PackageType, string[]> = {
  extension: ["extension", "extensions", "pi-extension", "pi-extensions"],
  skill: [
    "skill",
    "skills",
    "pi-skill",
    "pi-skills",
    "agent-skill",
    "agent-skills",
  ],
  prompt: [
    "prompt",
    "prompts",
    "pi-prompt",
    "pi-prompts",
    "prompt-template",
    "prompt-templates",
    "pi-prompt-template",
  ],
  theme: ["theme", "themes", "pi-theme", "pi-themes"],
};

// Returned in PACKAGE_TYPES order rather than keyword order, so the badges on two hits
// that carry the same kinds read the same way round.
export function packageTypes(keywords: unknown): PackageType[] {
  if (!Array.isArray(keywords)) return [];
  const have = new Set(keywords.map((k) => String(k).toLowerCase()));
  return PACKAGE_TYPES.filter((t) => TYPE_KEYWORDS[t].some((k) => have.has(k)));
}
