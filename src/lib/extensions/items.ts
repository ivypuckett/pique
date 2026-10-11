// Maps the installed extensions into Library rows. Pure: the fetch belongs to
// Library.svelte, which does all of its reads in one go.
import type { Extension } from "./bindings.ts";
import type { LibraryItem } from "../library/items.ts";

export function extensionItems(extensions: Extension[]): LibraryItem[] {
  return extensions.map((ext) => ({
    kind: "extension" as const,
    key: `extension/${ext.id}`,
    title: ext.name,
    // What the row is really identified by: a package's source string, or a local
    // module's path.
    subtitle: ext.source ?? ext.path,
    badge: ext.origin,
    ext,
  }));
}
