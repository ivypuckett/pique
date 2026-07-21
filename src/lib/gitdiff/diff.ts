// Splits a raw multi-file `git diff` into per-file pieces for @git-diff-view, which
// renders one <DiffView> per file. Each piece keeps the whole per-file unified diff
// as `hunk` (the lib parses `@@` headers out of it) plus the resolved old/new paths.

export interface FileDiff {
  oldName: string; // path, or "/dev/null" for an added file
  newName: string; // path, or "/dev/null" for a deleted file
  lang: string; // highlight.js language for the file, "" when unknown
  hunk: string; // the full per-file diff text (one @git-diff-view hunks[] element)
}

// highlight.js language names keyed by file extension. Unlisted extensions render
// without highlighting rather than guessing wrong.
const LANGS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  php: "php",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  xml: "xml",
  html: "xml",
  css: "css",
  scss: "scss",
  sh: "bash",
  bash: "bash",
  sql: "sql",
  md: "markdown",
};

export function langFromName(name: string): string {
  const base = name.split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // no extension (or dotfile) — nothing to key on
  return LANGS[base.slice(dot + 1).toLowerCase()] ?? "";
}

// Strip git's a//b/ prefix; leave /dev/null (and already-bare paths) untouched.
function stripPrefix(path: string): string {
  if (path === "/dev/null") return path;
  if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
  return path;
}

function parseSegment(seg: string): FileDiff {
  const lines = seg.split("\n");
  let oldName: string | undefined;
  let newName: string | undefined;
  for (const line of lines) {
    if (line.startsWith("--- ")) oldName = stripPrefix(line.slice(4));
    else if (line.startsWith("+++ ")) newName = stripPrefix(line.slice(4));
  }
  // No ---/+++ (e.g. a pure rename or mode change): fall back to the header,
  // `diff --git a/<old> b/<new>`.
  if (oldName === undefined || newName === undefined) {
    const m = lines[0].match(/^diff --git a\/(.*) b\/(.*)$/);
    if (m) {
      oldName ??= m[1];
      newName ??= m[2];
    }
  }
  oldName ??= "";
  newName ??= "";
  const named = newName === "/dev/null" ? oldName : newName;
  return { oldName, newName, lang: langFromName(named), hunk: seg };
}

export function splitDiff(raw: string): FileDiff[] {
  const lines = raw.split("\n");
  const segments: string[] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (cur) segments.push(cur.join("\n"));
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) segments.push(cur.join("\n"));
  return segments.map((s) => parseSegment(s.replace(/\n+$/, "")));
}
