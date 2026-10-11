// Local extensions: loose `.ts` modules in pi's extensions dir, written by the user or by
// an agent. Being there is what makes one run — pi loads every one at session start —
// so there is no state to track beyond the file itself. Runs Deno-side only.
import { livePath, liveDir } from "./paths.ts";

export type LocalExtension = { name: string };

// Local module names are the `*.ts` basenames in the dir. A missing dir means "none
// yet", not an error.
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        names.push(entry.name.slice(0, -3));
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return names.sort();
}

export async function listLocal(): Promise<LocalExtension[]> {
  return (await namesIn(liveDir())).map((name) => ({ name }));
}

// The source shown when a row is expanded — the exact bytes that run.
export async function readLocalSource(name: string): Promise<string> {
  return await Deno.readTextFile(livePath(name));
}

// Delete outright. Sessions already running keep it until they reload or restart.
export async function removeLocal(name: string): Promise<void> {
  await Deno.remove(livePath(name));
}
