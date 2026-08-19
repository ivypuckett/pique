// The path convention at the win.bind boundary: everything the desktop process hands
// the webview uses forward slashes, whatever the host separator is.
//
// The frontend cannot know the host platform — there is no `Deno` in the webview, so
// @std/path there resolves to posix no matter what the host is. Rather than teach the
// frontend about separators, the backend normalizes on the way out and the frontend
// stays posix-only (see filetree/tree.ts). Windows accepts forward slashes on input,
// so a path the frontend hands back still addresses the same file.
//
// Backend-internal paths stay native — this is only for values crossing the boundary.
// Runs Deno-side only.

// `\` is a separator on Windows and cannot occur in a filename there, so rewriting it
// is lossless. On POSIX it IS a legal filename character, so this must not touch it.
//
// `os` is a seam for the tests: the Windows branch is the whole point of this function
// and there is no Windows host to run the suite on.
export function toWebPath(path: string, os = Deno.build.os): string {
  return os === "windows" ? path.replaceAll("\\", "/") : path;
}
