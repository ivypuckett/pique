// Local extensions: loose `.ts` modules under a scope, written by the user or by an
// agent calling define_extension. The file's location IS the state — in extensions/ it
// runs, in pending/ it cannot — so there is no flag that could disagree with what pi
// loads. agent-tools.ts is the agent half and can only ever write into pending/.
// Runs Deno-side only.
import {
  ensureExtensionDirs,
  liveDir,
  livePath,
  pendingDir,
  pendingPath,
} from "./paths.ts";
import { chain, ROOT, type ScopeId } from "../scope/paths.ts";
import { movePath, pathExists, type PromoteResult } from "../scope/promote.ts";

export type LocalState = "pending" | "enabled";
export type LocalExtension = {
  name: string;
  state: LocalState;
  scope: ScopeId;
};

// Local module names are the `*.ts` basenames in a dir. A missing dir means "none yet"
// (nothing has been defined in this scope), not an error. `*.json` files in pending/
// are packages (packages.ts) and are skipped here.
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

// One scope's own local extensions, both lists in one call — the review UI always
// shows them together.
export async function listLocal(scope: ScopeId): Promise<LocalExtension[]> {
  const [pending, enabled] = await Promise.all([
    namesIn(pendingDir(scope)),
    namesIn(liveDir(scope)),
  ]);
  return [
    ...pending.map((name): LocalExtension => ({
      name,
      state: "pending",
      scope,
    })),
    ...enabled.map((name): LocalExtension => ({
      name,
      state: "enabled",
      scope,
    })),
  ];
}

// Every local extension an agent in `scope` can reach: its own, plus each ancestor's.
// Ordered root-first so the UI shows inherited ones above local ones.
export async function listVisibleLocal(
  scope: ScopeId,
): Promise<LocalExtension[]> {
  const out: LocalExtension[] = [];
  for (const s of chain(scope)) out.push(...await listLocal(s));
  return out;
}

// The enabled local modules `scope` inherits from its ancestors, as absolute FILE
// paths. pi's additionalExtensionPaths rejects a directory (verified against the SDK:
// a dir yields "Cannot find module" and the tools silently don't load), so this globs
// the files. A scope's OWN extensions are not listed — pi auto-discovers those from
// its agentDir. Packages are NOT inherited; see docs/extensions.md.
export async function inheritedExtensionFiles(
  scope: ScopeId,
): Promise<string[]> {
  const ancestors = chain(scope).filter((s) => s !== scope);
  const files: string[] = [];
  for (const s of ancestors) {
    for (const name of await namesIn(liveDir(s))) files.push(livePath(s, name));
  }
  return files;
}

// The source a human reviews before enabling — the exact bytes that will execute.
export async function readLocalSource(
  scope: ScopeId,
  name: string,
  state: LocalState,
): Promise<string> {
  return await Deno.readTextFile(
    state === "pending" ? pendingPath(scope, name) : livePath(scope, name),
  );
}

// Enable = move quarantine → live, within the same scope. From here pi loads it for
// that scope (and, for root, for every workspace) at the next session start. Rename
// replaces any same-named live file, so re-enabling a redefinition supersedes the old
// one rather than leaving both.
export async function enableLocal(scope: ScopeId, name: string): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.rename(pendingPath(scope, name), livePath(scope, name));
}

// Revoke = move live → quarantine. It stops running (at the next session start) but the
// source is kept, and re-enabling it goes back through review — the same trip a package
// makes when it is disabled and re-enabled. Deleting the bytes is removeLocal, below.
export async function revokeLocal(scope: ScopeId, name: string): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.rename(livePath(scope, name), pendingPath(scope, name));
}

// Delete outright, from whichever dir it is in. Sessions already running keep a
// previously-enabled module until they restart (see docs/extensions.md).
export async function removeLocal(
  scope: ScopeId,
  name: string,
  state: LocalState,
): Promise<void> {
  await Deno.remove(
    state === "pending" ? pendingPath(scope, name) : livePath(scope, name),
  );
}

// Promote = move the module into ROOT's QUARANTINE, whatever state it held in the
// workspace. It does not arrive enabled: enabling in root is what lets code run in
// every workspace, and that decision belongs to a fresh review against the bytes, not
// to a review someone did once for one workspace.
//
// The clash is tested against BOTH of root's dirs. A same-named module already live in
// root is exactly the case where silently landing beside it would matter — the promoted
// copy would sit unenabled in quarantine while the old one kept running.
export async function promoteLocal(
  scope: ScopeId,
  name: string,
  state: LocalState,
  overwrite: boolean,
): Promise<PromoteResult> {
  await ensureExtensionDirs(ROOT);
  if (await pathExists(livePath(ROOT, name))) {
    if (!overwrite) return { conflict: true };
    await Deno.remove(livePath(ROOT, name));
  }
  return await movePath(
    state === "pending" ? pendingPath(scope, name) : livePath(scope, name),
    pendingPath(ROOT, name),
    overwrite,
  );
}
