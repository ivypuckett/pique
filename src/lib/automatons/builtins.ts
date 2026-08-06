// pi's own builtin tool names, and nothing else.
//
// Its own module because both halves need it and nothing else can carry it: `parse.ts`
// owns the file format but imports `@std/front-matter`, which the frontend bundle cannot
// resolve, and `resolve.ts` imports the pi SDK. This file imports nothing, so the
// automaton editor and the launch path read the same list rather than two copies that
// can drift.
//
// Every one of these is present in a session unless excluded
// (`createAllToolDefinitions`, SDK 0.83). If a future pi adds a builtin, an automaton
// naming it fails validation until this list is updated — the safe direction, since the
// alternative is a name that silently restricts nothing.
//
// Only the first four are ACTIVE by pi's default; `grep`, `find` and `ls` are registered
// but inactive, which is why `run.ts` activates a `tools:` selection explicitly rather
// than relying on exclusion alone.
export const PI_BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;
