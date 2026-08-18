// One hash over a set of files, used by every review gate: what the human read is
// pinned by its digest, and the enable/approve refuses if the bytes moved since
// (extensions/service.ts, automatons/approval.ts). Pure — no filesystem — so a caller
// decides what the reviewed set is and this only says whether two sets are the same.
//
// Paths as well as contents, so swapping which files a reviewed set resolves to counts
// as a change even when every individual file still reads the same. NUL separates the
// fields because it cannot occur in a path and will not occur in source — concatenating
// them plainly would let a file whose text ends in the next file's name collide.
export async function digestOf(
  files: { path: string; text: string }[],
): Promise<string> {
  const joined = files.map((f) => `${f.path}\u0000${f.text}`).join(
    "\u0000\u0000",
  );
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(joined),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
