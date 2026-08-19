// Completion logic for the working-directory picker (PathInput.svelte). Pure — the
// listing itself comes from the listDir bind (settings/bindings.ts).
//
// Paths are split on "/" by hand, for the same reason filetree/tree.ts does it: this
// module is bundled into the webview, where Vite cannot resolve JSR specifiers, so
// @std/path is not importable. It is also unnecessary — the backend normalizes every
// path it hands over to forward slashes (see path.ts), and Windows accepts them back.
import type { Entry } from "./fs.ts";

// Split typed text into the directory to list and the prefix to filter its children by:
// "~/work/pi" lists "~/work/" and matches "pi". Text with no "/" names no directory,
// so there is nothing to complete against — null, and the caller shows no suggestions.
export function splitPath(
  text: string,
): { parent: string; frag: string } | null {
  const i = text.lastIndexOf("/");
  if (i < 0) return null;
  return { parent: text.slice(0, i + 1), frag: text.slice(i + 1) };
}

// The entries offered for `frag`, alphabetical and case-insensitive on both sides.
// Symlinks are offered alongside directories: listDir reports a symlinked directory as
// isDir false (it does not follow links), and ~/work -> /mnt/work is a destination the
// picker has to be able to reach. A symlink to a file can be offered too — drilling into
// it fails to list, which is how the box already reports a path that isn't a directory.
export function suggest(entries: Entry[], frag: string): Entry[] {
  const f = frag.toLowerCase();
  return entries
    .filter((e) =>
      (e.isDir || e.isSymlink) && e.name.toLowerCase().startsWith(f)
    )
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// Take a suggestion: the fragment becomes the chosen name, and the trailing "/" is what
// makes the next level list. Drilling in never commits — Enter on the box does that.
export function drill(parent: string, name: string): string {
  return `${parent}${name}/`;
}

// The value handed to the workspace. The trailing "/" drill leaves behind is a
// completion artifact rather than part of the path, so it comes off — except on "/"
// itself, which is the whole path on a POSIX host.
export function normalize(text: string): string {
  const t = text.trim();
  return t.length > 1 && t.endsWith("/") ? t.slice(0, -1) : t;
}
