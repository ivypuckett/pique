// Maps the installed modules into Library rows. Pure: the fetch belongs to
// Library.svelte. Mirrors extensions/items.ts, which is the shape this follows.
import type { LibraryItem } from "../library/items.ts";
import type { InstalledModule } from "./bindings.ts";

export function moduleItems(installed: InstalledModule[]): LibraryItem[] {
  return installed.map((m) => ({
    kind: "module" as const,
    key: `module/${m.kind}`,
    title: m.label,
    subtitle: m.kind,
    badge: "module",
    module: m,
  }));
}
