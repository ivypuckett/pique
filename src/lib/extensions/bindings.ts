// Frontend half of the extensions binding contract. The backend half is the
// extensions* win.bind handlers in src/desktop.ts (delegating to service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { Extension, ExtensionSource, ExtState } from "./service.ts";
import type { ExtSearchResult } from "./packages.ts";
import type { PackageType } from "./catalog.ts";
export type {
  Extension,
  ExtensionSource,
  ExtSearchResult,
  ExtState,
  PackageType,
};
// A VALUE, so it must not come from packages.ts: that module imports pi's
// DefaultPackageManager, which does not survive being bundled for the browser.
export { PACKAGE_TYPES } from "./catalog.ts";

// Every call names the scope it acts on: an extension belongs to one scope, and
// enabling in root is what makes a local one visible to every workspace.
// `extensionsList` is a scope's own extensions (the ones it can act on);
// `extensionsVisible` adds what it inherits (local modules only — packages are not
// inherited, see docs/extensions.md).
export interface ExtensionBindings {
  extensionsList(arg: { scope: string }): Promise<Extension[]>;
  extensionsVisible(arg: { scope: string }): Promise<Extension[]>;
  extensionsRead(
    arg: { scope: string; id: string; state: ExtState },
  ): Promise<ExtensionSource>;
  // `expectDigest` is the reading the user reviewed; the backend refuses the enable
  // if the bytes changed since (service.ts:enableExtension).
  extensionsEnable(
    arg: { scope: string; id: string; expectDigest?: string },
  ): Promise<unknown>;
  // Enabled extensions pi could not load — `enabled` and broken look identical
  // in the list otherwise.
  extensionsLoadErrors(
    arg: { scope: string },
  ): Promise<Array<{ name: string; error: string }>>;
  extensionsRevoke(arg: { scope: string; id: string }): Promise<unknown>;
  extensionsRemove(
    arg: { scope: string; id: string; state: ExtState },
  ): Promise<unknown>;
  // Fetches the bytes and quarantines them; it does NOT enable the package.
  extensionsFetch(arg: { scope: string; source: string }): Promise<unknown>;
  // `type` narrows the catalog to packages carrying that kind, the way
  // pi.dev/packages?type=skill does. Omitted means every kind.
  extensionsSearch(
    arg: { query: string; type?: PackageType },
  ): Promise<ExtSearchResult[]>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Extensions
// section then shows a desktop-only note, same as providers.
export function extensionBindings(): ExtensionBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ExtensionBindings) : null;
}
