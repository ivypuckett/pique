// Typed access to the deno desktop bindings bridge. `globalThis.bindings` is a callable
// proxy injected only inside the desktop window; it is undefined in a plain browser tab.

export interface TerminalBindings {
  termStart(arg: { cols: number; rows: number }): Promise<{ id: string }>;
  termWrite(arg: { id: string; data: string }): Promise<unknown>;
  termRead(arg: { id: string }): Promise<{ data: Uint8Array; done: boolean }>;
  termResize(arg: { id: string; cols: number; rows: number }): Promise<unknown>;
  termKill(arg: { id: string }): Promise<unknown>;
}

export function terminalBindings(): TerminalBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as TerminalBindings) : null;
}
