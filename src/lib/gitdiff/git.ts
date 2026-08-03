// Backend for the git-diff module. Pure Deno subprocess — no webview.
// Runs `git diff` (working tree vs index) or `git diff --cached` (index vs HEAD)
// and returns the raw unified-diff text. The frontend splits and renders it.

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
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
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
      path: `${top.replace(/\/$/, "")}/${rel}`,
      untracked: xy === "??",
    });
  }
  return changes;
}

// Changed paths for the single repo containing `dir`, or null if `dir` is not in a repo.
async function repoChanges(dir: string): Promise<ChangedPath[] | null> {
  const top = await run(dir, ["rev-parse", "--show-toplevel"]);
  if (top === null) return null;
  const out = await run(dir, ["status", "--porcelain", "-z"]);
  if (out === null) return null;
  return parsePorcelain(out, top.trim());
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

// Changed paths under `root`. If `root` is itself a repo we read it directly; otherwise
// (a workspace holding many repos) we descend through non-repo subdirs to find the repos
// inside and union their changes, so their folders can be highlighted. Depth-capped and
// skipping hidden dirs / node_modules to keep the scan cheap.
export async function changedPaths(
  root: string,
  depth = 3,
): Promise<ChangedPath[]> {
  const direct = await repoChanges(root);
  if (direct !== null) return direct;
  if (depth <= 0) return [];
  const out: ChangedPath[] = [];
  let subs: Deno.DirEntry[];
  try {
    subs = [];
    for await (const e of Deno.readDir(root)) subs.push(e);
  } catch {
    return [];
  }
  for (const e of subs) {
    if (!e.isDirectory || e.name.startsWith(".") || e.name === "node_modules") {
      continue;
    }
    out.push(
      ...await changedPaths(`${root.replace(/\/$/, "")}/${e.name}`, depth - 1),
    );
  }
  return out;
}

export async function gitDiff(
  cwd: string,
  staged: boolean,
  path?: string,
): Promise<string> {
  const args = [
    "diff",
    ...(staged ? ["--cached"] : []),
    ...(path ? ["--", path] : []),
  ];
  const cmd = new Deno.Command("git", {
    args,
    cwd: await runDir(cwd, path),
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
