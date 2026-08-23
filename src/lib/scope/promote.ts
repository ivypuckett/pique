// Moving a library item UP the scope chain: out of the workspace that owns it and into
// root, where every workspace inherits it. The per-kind halves live in that kind's own
// service (agents/, prompts/, skills/, extensions/), the way every other cross-kind
// Library operation does; this module holds only what all of them share. Runs
// Deno-side only.
//
// Promote MOVES rather than copies. A copy would leave the workspace's own item behind,
// and every kind here resolves nearest-first — so the workspace would go on using its
// own file while root's twin drifted, which is the opposite of what promoting is for.
import { ROOT, type ScopeId } from "./paths.ts";

// A promote either happens, or stops because root already holds that name. The clash is
// a RETURN rather than a throw because it is a question for the user — overwriting
// root's copy reaches every workspace — and the UI asks it, then calls again with
// `overwrite`.
export type PromoteResult = { ok: true } | { conflict: true };

// Root has nowhere to promote to, and the Library hides the button there — this states
// that rather than trusting the webview, which is untrusted (docs/security.md).
export function assertPromotable(scope: ScopeId): void {
  if (scope === ROOT) {
    throw new Error(
      "Root is already the workspace everything is inherited from.",
    );
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

// The move itself. The destination is removed before the rename rather than relying on
// rename's own replace: that only covers a file, and a skill is a directory — over a
// non-empty one rename fails instead. One rule for both shapes.
export async function movePath(
  from: string,
  to: string,
  overwrite: boolean,
): Promise<PromoteResult> {
  if (await pathExists(to)) {
    if (!overwrite) return { conflict: true };
    await Deno.remove(to, { recursive: true });
  }
  await Deno.rename(from, to);
  return { ok: true };
}
