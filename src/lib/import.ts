// "Import from pi": copy the `pi` CLI's setup (~/.pi/agent) into pique's agent dir, so
// extensions, packages, prompt templates, skills, the prompt files and provider
// credentials come across in one step. Runs Deno-side only.
//
// Nothing pique already has is overwritten — a file present in both keeps pique's copy —
// so importing twice, or after setting things up here, is safe. Two exceptions to a
// plain copy:
//
//   sessions/       pi's own chat history, not setup; left behind.
//   settings.json   merged rather than skipped, so its packages come across even when
//                   pique already has one: pique's values win, package lists are
//                   joined.
import { resolve } from "@std/path";
import { agentDir, piAgentDir } from "./paths.ts";

export type ImportResult = { copied: number; kept: number };

const LEFT_BEHIND = new Set(["sessions"]);

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

// A package entry is a source string or an object carrying one; either way the source
// is what makes two entries the same package.
function packageKey(p: unknown): string {
  if (typeof p === "string") return p;
  const source = (p as { source?: unknown } | null)?.source;
  return typeof source === "string" ? source : JSON.stringify(p);
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(path));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function mergeSettings(from: string, to: string): Promise<void> {
  const theirs = await readSettings(from);
  const ours = await readSettings(to);
  const merged: Record<string, unknown> = { ...theirs, ...ours };
  const packages = [
    ...(Array.isArray(ours.packages) ? ours.packages : []),
    ...(Array.isArray(theirs.packages) ? theirs.packages : []),
  ];
  if (packages.length > 0) {
    const seen = new Set<string>();
    merged.packages = packages.filter((p) => {
      const key = packageKey(p);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  await Deno.writeTextFile(to, JSON.stringify(merged, null, 2) + "\n");
}

async function copyTree(
  from: string,
  to: string,
  result: ImportResult,
  top: boolean,
): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    if (top && LEFT_BEHIND.has(entry.name)) continue;
    const src = `${from}/${entry.name}`;
    const dest = `${to}/${entry.name}`;
    if (top && entry.name === "settings.json") {
      await mergeSettings(src, dest);
      result.copied++;
    } else if (entry.isDirectory) {
      await copyTree(src, dest, result, false);
    } else if (await exists(dest)) {
      result.kept++;
    } else if (entry.isSymlink) {
      // An installed package's node_modules/.bin is links; keep them links.
      await Deno.symlink(await Deno.readLink(src), dest);
      result.copied++;
    } else {
      await Deno.copyFile(src, dest);
      result.copied++;
    }
  }
}

export async function importFromPi(
  from = piAgentDir(),
  to = agentDir(),
): Promise<ImportResult> {
  if (resolve(from) === resolve(to)) {
    throw new Error(`${to} is already pi's own folder — there is nothing to import.`);
  }
  if (!(await exists(from))) {
    throw new Error(`No pi setup found at ${from}.`);
  }
  const result: ImportResult = { copied: 0, kept: 0 };
  await copyTree(from, to, result, true);
  return result;
}
