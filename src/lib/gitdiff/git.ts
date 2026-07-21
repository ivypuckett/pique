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

export async function gitDiff(cwd: string, staged: boolean, path?: string): Promise<string> {
  const args = ["diff", ...(staged ? ["--cached"] : []), ...(path ? ["--", path] : [])];
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
