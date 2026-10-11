// Frontend half of the user-module binding contract. The backend half is the module*
// win.bind handlers in src/desktop.ts — keep arg/return shapes in sync by hand
// (separate module graphs). `globalThis.bindings` exists only inside the desktop
// window; in a browser tab this returns null and UserModule.svelte renders its
// desktop-only placeholder, as Terminal and Chat do.
import { type ModuleDef, setInstalledModules } from "./manifest.ts";
import { writable } from "svelte/store";

// Bumped every time the table is refilled. The table itself is a plain array in
// manifest.ts — deliberately, so the pure layout reducers and their deno tests can read
// it without loading a .svelte file — which means nothing re-renders when it changes.
// Components that read the table build a LIST once (ModuleRail's rows) and subscribe to
// this to know when to rebuild it.
export const modulesVersion = writable(0);

// Mirrors modules/service.ts's InstalledModule. Kept in sync by hand — separate module
// graphs — and deliberately structural rather than imported: service.ts calls Deno APIs,
// and a value import from it would break the frontend bundle.
export type InstalledModule = {
  kind: string;
  label: string;
  duplicable?: boolean;
};

export interface ModuleBindings {
  // What the Library shows: every installed module.
  moduleList(): Promise<InstalledModule[]>;
  // Deletes the module's definition and document.
  moduleRemove(arg: { name: string }): Promise<unknown>;
  // Where to point a module's iframe, plus what is installed. The port is the module
  // file server's (modules/server.ts), assigned at boot.
  moduleManifest(): Promise<{ port: number; modules: unknown[] }>;
  // One door for everything a module asks for (modules/handlers.ts). `moduleId` is
  // supplied by the HOST component, never by the frame. Rejects with the handler's
  // error, or when `method` is not one a module can call.
  moduleCall(
    arg: { moduleId: string; method: string; payload: unknown },
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
    modulesVersion.update((n) => n + 1);
  } catch {
    // A backend without the handler (an older build) simply has no user modules.
  }
}
