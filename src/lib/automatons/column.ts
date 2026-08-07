// When two column names are the same name, and nothing else.
//
// Its own module for the reason `wip.ts` and `builtins.ts` are: the rule is needed on
// both sides of a bundling boundary. `kanban.ts`'s `watches()` is what actually DECIDES
// whether a card fires an automaton, but it imports the pi-side run machinery, and
// `parse.ts` imports `@std/front-matter` — neither can reach the frontend bundle. The UI
// still has to answer "does the board have this column?" with exactly the answer the
// dispatcher will give, or it ends up badging a working trigger as broken. This file
// imports nothing, so both sides share the rule instead of two copies that can drift.
//
// Trimmed and lowercased, because the name is typed by hand in the automaton file and
// rendered by the board from its own row — the two spellings meet only here.
export function normalizeColumn(name: string): string {
  return name.trim().toLowerCase();
}
