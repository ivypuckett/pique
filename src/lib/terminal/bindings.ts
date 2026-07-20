// Typed access to the deno desktop bindings bridge. `globalThis.bindings` is a callable
// proxy injected only inside the desktop window; it is undefined in a plain browser tab.
//
// This interface is the frontend half of a hand-maintained contract — the backend half
// is the `win.bind(...)` handlers in `src/desktop.ts`. They run in separate module
// graphs, so nothing checks them against each other at compile time: keep the arg and
// return shapes here in sync with desktop.ts by hand (e.g. termRead returns number[],
// not Uint8Array, because binding values must be plain JSON).

export interface TerminalBindings {
  termStart(arg: { cols: number; rows: number; cwd?: string; argv?: string[] }): Promise<{ id: string }>;
  termWrite(arg: { id: string; data: string }): Promise<unknown>;
  termRead(arg: { id: string }): Promise<{ data: number[]; done: boolean }>;
  termResize(arg: { id: string; cols: number; rows: number }): Promise<unknown>;
  termKill(arg: { id: string }): Promise<unknown>;
}

export function terminalBindings(): TerminalBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as TerminalBindings) : null;
}
