// On-disk location of local extensions: `extensions/` in pi's agent dir (paths.ts), which
// pi auto-discovers — every `<name>.ts` there runs at session start. User modules sit
// beside them (modules/service.ts). Runs Deno-side only.
import { agentDir } from "../paths.ts";

// Local extension names become filenames, so constrain them so a name can never escape
// its dir (no separators / traversal). The shape is also what pi wants of an
// LLM-callable tool name, since these modules exist to register one.
const NAME_RE = /^[a-z][a-z0-9_]*$/;

export function liveDir(): string {
  return `${agentDir()}/extensions`;
}

export function assertExtensionName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid extension name: ${name}`);
}

export function livePath(name: string): string {
  assertExtensionName(name);
  return `${liveDir()}/${name}.ts`;
}

export async function ensureExtensionDirs(): Promise<void> {
  await Deno.mkdir(liveDir(), { recursive: true });
}
