// The `wip:` rule, and nothing else.
//
// Its own module for the reason `builtins.ts` is: both halves need it, and `parse.ts`
// — where the rule was born and where it is still applied — imports
// `@std/front-matter`, which the frontend bundle cannot resolve. This file imports
// nothing, so the automaton editor checks a typed limit with the very function the
// parser validates the saved file with, rather than a second copy that can drift.

// The narrowed predicate. The field-derivation site in `parse.ts` needs the `number`
// type to keep `wip` typed, and `wipError` needs the message — one predicate serves
// both.
export function isValidWip(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

// The error message for a `wip:` value, or undefined when it is fine. The `cronError` of
// this module: a limit that is not a limit — `0`, `1.5`, `"3"` — must fail the definition
// rather than be quietly ignored, or a file that says it holds itself to three at a time
// would run unbounded.
export function wipError(value: unknown): string | undefined {
  return isValidWip(value)
    ? undefined
    : `wip: expected a whole number of 1 or more, got ${JSON.stringify(value)}`;
}
