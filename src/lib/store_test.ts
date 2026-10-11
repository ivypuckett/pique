import { assertEquals } from "@std/assert";
import { get } from "svelte/store";
import { hydrateSession, session } from "./store.ts";
import { createInitialSession } from "./session.ts";

// hydrateSession goes through the config bindings, so an in-memory stub is enough to
// observe exactly what it reads.
function stubBindings(files: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).bindings = {
    configRead: ({ name }: { name: string }) =>
      Promise.resolve(files[name] ?? null),
    configWrite: () => Promise.resolve(true),
  };
}

// The store module keeps a module-level `hydrated` flag and a debounced write timer,
// so this tolerates the pending timer.
Deno.test({
  name:
    "hydrating a layout whose selected row is gone falls back to an offered one",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const saved = createInitialSession();
    const view = saved.workspaces[0].views[0];
    view.right = {
      activeGroup: "notes", // a module that is no longer installed
      tabs: [
        ...view.right.tabs,
        { id: "right-9", title: "Notes", kind: "notes", group: "notes" },
      ],
      activeTabs: { ...view.right.activeTabs, notes: "right-9" },
    };
    stubBindings({ layout: saved });

    await hydrateSession();

    const right = get(session).workspaces[0].views[0].right;
    assertEquals(right.activeGroup, "terminal");
    assertEquals(right.tabs.map((t) => t.id), ["right-1", "right-9"]);
  },
});
