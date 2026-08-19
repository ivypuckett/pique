// Backend for the git-diff module. Pure Deno subprocess — no webview.
// Runs `git diff` (working tree vs index) or `git diff --cached` (index vs HEAD)
// and returns the raw unified-diff text. The frontend splits and renders it.
//
// Changed paths are compared against the file tree's own node paths, so they cross the
// win.bind boundary and get normalized to forward slashes (see ../path.ts). Diff
// headers are forward-slashed too — that is git's format, not the host's.
import { dirname, join, relative } from "@std/path";
import { toWebPath } from "../path.ts";

// The directory to run git from. When a path is targeted we run from that path's own
// directory so git discovers the repo that contains it — a workspace rooted at a parent
// of many repos (e.g. ~/workspace) is not itself a repo, so running from `cwd` there
// fails. Falls back to `cwd` for the whole-workspace diff (no path).
async function runDir(cwd: string, path?: string): Promise<string> {
  if (!path) return cwd;
  try {
    if ((await Deno.stat(path)).isDirectory) return path;
  } catch {
    // fall through to the parent dir
  }
  return dirname(path);
}

// One changed path reported by `git status`, made absolute. `untracked` marks files
// git isn't tracking yet (porcelain `??`) so the UI can color them like VS Code does.
export interface ChangedPath {
  path: string;
  untracked: boolean;
}

// Parse `git status --porcelain -z` output into absolute changed paths. The -z format is
// NUL-separated "XY <path>" records; a rename adds a second NUL-separated "<from>" record
// (which we skip — only the destination path matters for highlighting).
export function parsePorcelain(out: string, top: string): ChangedPath[] {
  const changes: ChangedPath[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (rec === "") continue;
    const xy = rec.slice(0, 2);
    const rel = rec.slice(3);
    if (xy[0] === "R" || xy[0] === "C") i++; // rename/copy: consume the trailing origin path
    changes.push({
      path: toWebPath(join(top, rel)),
      untracked: xy === "??",
    });
  }
  return changes;
}

// Changed paths for the repo whose toplevel is `top`, or null if git fails there.
async function repoChanges(top: string): Promise<ChangedPath[] | null> {
  const out = await run(top, ["status", "--porcelain", "-z"]);
  if (out === null) return null;
  return parsePorcelain(out, top);
}

// Run git in `dir`, returning stdout, or null on a non-zero exit (e.g. not a repo).
async function run(dir: string, args: string[]): Promise<string | null> {
  const cmd = new Deno.Command("git", {
    args,
    cwd: dir,
    stdout: "piped",
    stderr: "null",
  });
  const { code, stdout } = await cmd.output();
  if (code !== 0) return null;
  return new TextDecoder().decode(stdout);
}

// Toplevel dirs of the repos at or under `root`. If `root` is inside a repo that repo is
// the whole answer; otherwise (a workspace holding many repos) we descend through the
// non-repo subdirs to find the repos inside. Depth-capped and skipping hidden dirs /
// node_modules to keep the scan cheap. Sorted so the caller's output is stable.
export async function findRepos(root: string, depth = 3): Promise<string[]> {
  const top = await run(root, ["rev-parse", "--show-toplevel"]);
  if (top !== null) return [top.trim()];
  if (depth <= 0) return [];
  let subs: Deno.DirEntry[];
  try {
    subs = [];
    for await (const e of Deno.readDir(root)) subs.push(e);
  } catch {
    return [];
  }
  subs.sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  for (const e of subs) {
    if (!e.isDirectory || e.name.startsWith(".") || e.name === "node_modules") {
      continue;
    }
    out.push(
      ...await findRepos(join(root, e.name), depth - 1),
    );
  }
  return out;
}

// Changed paths under `root`, unioned across every repo found there, so the folders of a
// multi-repo workspace can be highlighted too.
export async function changedPaths(
  root: string,
  depth = 3,
): Promise<ChangedPath[]> {
  const out: ChangedPath[] = [];
  for (const repo of await findRepos(root, depth)) {
    out.push(...await repoChanges(repo) ?? []);
  }
  return out;
}

// Re-root one repo's diff under `prefix` (its path relative to the workspace) so files
// from different repos stay distinguishable once several diffs are concatenated — two
// repos both changing src/a.ts would otherwise render as the same name twice.
// Only the header lines of each file section are rewritten: a removed body line reading
// "-- x" arrives as "--- x", so anything from the first `@@` onward is left alone.
export function prefixDiffPaths(diff: string, prefix: string): string {
  if (prefix === "") return diff;
  let header = false;
  return diff.split("\n").map((line) => {
    if (line.startsWith("diff --git ")) header = true;
    else if (line.startsWith("@@")) header = false;
    if (!header) return line;
    const m = line.match(/^(diff --git a\/)(.*)( b\/)(.*)$/);
    if (m) return `${m[1]}${prefix}/${m[2]}${m[3]}${prefix}/${m[4]}`;
    for (const [tag, side] of [["--- ", "a/"], ["+++ ", "b/"]]) {
      if (line.startsWith(tag + side)) {
        return `${tag}${side}${prefix}/${line.slice(tag.length + side.length)}`;
      }
    }
    return line; // /dev/null, index, mode and similarity lines carry no path to re-root
  }).join("\n");
}

// Run `git diff` in `dir` and return its output, throwing git's own message on failure.
async function diffIn(
  dir: string,
  staged: boolean,
  path?: string,
): Promise<string> {
  const cmd = new Deno.Command("git", {
    args: [
      "diff",
      ...(staged ? ["--cached"] : []),
      ...(path ? ["--", path] : []),
    ],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    const msg = new TextDecoder().decode(stderr).trim();
    // Not a repo, git missing, etc. — surface it so the module can show why.
    throw new Error(msg || `git diff exited with code ${code}`);
  }
  return new TextDecoder().decode(stdout);
}

export async function gitDiff(
  cwd: string,
  staged: boolean,
  path?: string,
  depth = 3,
): Promise<string> {
  if (path) return await diffIn(await runDir(cwd, path), staged, path);
  // A workspace rooted at a parent of many repos (e.g. ~/workspace) is not itself a repo,
  // so `git diff` there only prints its "not a git repository" usage text. Diff each repo
  // underneath instead and concatenate, which is what the file tree already highlights.
  const repos = await findRepos(cwd, depth);
  // Nothing here is a repo. Say so plainly rather than letting git print its --no-index
  // usage text, and name the depth we searched — repos nested deeper than the configured
  // gitScanDepth look identical to none at all from here.
  if (repos.length === 0) {
    const below = depth > 0
      ? ` or the ${depth} level${depth === 1 ? "" : "s"} below it`
      : "";
    throw new Error(`No git repository in ${cwd}${below}.`);
  }
  if (repos.length === 1) return await diffIn(repos[0], staged);
  const parts: string[] = [];
  for (const repo of repos) {
    const diff = await diffIn(repo, staged);
    if (diff !== "") {
      // Forward-slashed: this becomes part of a diff header path, which is git's
      // format on every host, not the host separator.
      parts.push(prefixDiffPaths(diff, toWebPath(relative(cwd, repo))));
    }
  }
  return parts.join("");
}
