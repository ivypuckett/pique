// Frontend half of the extensions binding contract. The backend half is the
// extensions* win.bind handlers in src/desktop.ts (delegating to service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { Extension, ExtensionSource } from "./service.ts";
import type { ExtSearchResult } from "./packages.ts";
import type { PackageType } from "./catalog.ts";
export type { Extension, ExtensionSource, ExtSearchResult, PackageType };
// A VALUE, so it must not come from packages.ts: that module imports pi's
// DefaultPackageManager, which does not survive being bundled for the browser.
export { PACKAGE_TYPES } from "./catalog.ts";

export interface ExtensionBindings {
  extensionsList(): Promise<Extension[]>;
  extensionsRead(arg: { id: string }): Promise<ExtensionSource>;
  // Installed extensions pi could not load — installed and broken look identical in the
  // list otherwise.
  extensionsLoadErrors(): Promise<Array<{ name: string; error: string }>>;
  extensionsRemove(arg: { id: string }): Promise<unknown>;
  // Downloads the package and adds it to pi's settings.json.
  extensionsInstall(arg: { source: string }): Promise<unknown>;
  // `type` narrows the catalog to packages carrying that kind, the way
  // pi.dev/packages?type=skill does. Omitted means every kind.
  extensionsSearch(
    arg: { query: string; type?: PackageType },
  ): Promise<ExtSearchResult[]>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Library then
// shows a desktop-only note, same as providers.
export function extensionBindings(): ExtensionBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ExtensionBindings) : null;
}
