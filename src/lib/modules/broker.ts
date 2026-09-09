// The one door between a user module's frame and everything pique can do. Every call a
// frame makes arrives here, is checked against that module's granted capabilities, and
// only then reaches a handler. Runs Deno-side.
//
// Two rules hold the whole design up, and both are about what this function does NOT
// take from the caller:
//
// - `scope` is the host's, passed in by the component that mounted the frame. A frame
//   never sends one, and a `scope` in the payload is ignored — so a module in ws-1
//   cannot read root's board by asking nicely.
// - `manifest` is resolved from disk for the module the host says this is, not from
//   anything the frame said about itself. A frame cannot name a module, so it cannot
//   name a different one.
import { allows, type Manifest } from "./capabilities.ts";

// A capability's implementation. Handlers receive the scope from the broker and never
// look one up themselves — the same rule as above, one layer down.
export type Handler = (scope: string, payload: unknown) => Promise<unknown>;
export type Handlers = Record<string, Handler>;

// Injected rather than imported so the refusal path can be tested for what it did NOT
// do. A test passes recording handlers and asserts none of them ran.
export async function dispatch(
  manifest: Manifest,
  scope: string,
  method: string,
  payload: unknown,
  handlers: Handlers,
): Promise<unknown> {
  // Check first, always. Nothing below this line may run for a call the manifest does
  // not cover, including anything a handler might do "just to look".
  if (!allows(manifest, method, payload)) {
    // Names the method, because a module author reads this in their own panel. It does
    // NOT name the capability that would have been needed: that reads as a hint for
    // what to ask for next, and the consent screen is where that conversation belongs.
    throw new Error(`${method} is not granted to ${manifest.kind}`);
  }
  const handler = handlers[method];
  if (!handler) {
    // Distinct wording from a refusal on purpose: this is a gap in pique, not a
    // permission the user withheld, and conflating them sends the author to the wrong
    // place.
    throw new Error(`${method} is not implemented`);
  }
  return await handler(scope, payload);
}
