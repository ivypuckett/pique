// Frontend half of the git-diff binding contract. The backend half is the gitDiff
// win.bind handler in src/desktop.ts — keep arg/return shapes in sync by hand.
// `globalThis.bindings` is injected only inside the desktop window; undefined in a
// plain browser tab.
export interface GitDiffBindings {
  gitDiff(
    arg: { cwd?: string; staged?: boolean; path?: string },
  ): Promise<{ diff: string }>;
}

export function gitDiffBindings(): GitDiffBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as GitDiffBindings) : null;
}
