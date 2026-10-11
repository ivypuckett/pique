// On-disk location of skills: `skills/` in pi's agent dir (paths.ts), which pi
// auto-discovers itself.
//
// pique lists skills; it does not install or edit them. Runs Deno-side only.
import { agentDir } from "../paths.ts";

// A skill name is a path basename, so it is constrained the way a prompt template name is: no separators, no traversal.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function skillsDir(): string {
  return `${agentDir()}/skills`;
}

export function assertSkillName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid skill name: ${name}`);
}
