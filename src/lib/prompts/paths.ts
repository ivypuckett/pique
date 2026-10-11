// On-disk location of prompt templates — reusable markdown snippets a user invokes by
// typing `/name` in a Chat module (see docs/prompts.md). `prompts/` in pi's agent dir
// (paths.ts), which pi discovers itself. Runs Deno-side only.
import { agentDir } from "../paths.ts";

// A template name is a filename AND the token typed after `/`, so it is constrained: no
// separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function promptsDir(): string {
  return `${agentDir()}/prompts`;
}

export function assertPromptName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid prompt name: ${name}`);
}

export function promptPath(name: string): string {
  assertPromptName(name);
  return `${promptsDir()}/${name}.md`;
}

export async function ensurePromptDirs(): Promise<void> {
  await Deno.mkdir(promptsDir(), { recursive: true });
}
