// Frontend half of the user-module binding contract. The backend half is the module*
// win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by hand
// (separate module graphs). `globalThis.bindings` exists only inside the desktop
// window; in a browser tab this returns null and UserModule.svelte renders its
// desktop-only placeholder, as Terminal and Chat do.
import { type ModuleDef, setInstalledModules } from "./manifest.ts";

export interface ModuleBindings {
  // Where to point a module's iframe, plus what this scope has installed. The port is
  // the module file server's (modules/server.ts), assigned at boot.
  moduleManifest(): Promise<{ port: number; modules: unknown[] }>;
  // One door for everything a module asks for. `moduleId` and `scope` are supplied by
  // the HOST component, never by the frame — a frame cannot name a module, so it has
  // nothing to forge. Rejects with the refusal message when the module's manifest does
  // not grant `method`.
  moduleCall(
    arg: { moduleId: string; scope: string; method: string; payload: unknown },
  ): Promise<unknown>;
}

export function moduleBindings(): ModuleBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ModuleBindings) : null;
}

// The module file server's port, read once at hydration so a frame can be addressed
// synchronously when it mounts.
let uiPort = 0;

export function moduleUiPort(): number {
  return uiPort;
}

// Populate the module table BEFORE the first render, alongside the other hydrations in
// main.ts. It has to be before rather than in onMount: `moduleDef` is a plain function
// over a plain array, not reactive state, so a table filled after mount leaves every
// already-rendered tab of a user module showing "Unknown module" until something else
// happens to re-render it. Hydrating first is also what the layout hydration does, and
// for the same reason.
export async function hydrateModules(): Promise<void> {
  const b = moduleBindings();
  if (!b) return; // web mode: no backend, no modules
  try {
    const { port, modules } = await b.moduleManifest();
    uiPort = port;
    setInstalledModules(modules as ModuleDef[]);
  } catch {
    // A backend without the handler (an older build) simply has no user modules.
  }
}
