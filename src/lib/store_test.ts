import { assertEquals } from "@std/assert";
import { get } from "svelte/store";
import { hydrateSession, session } from "./store.ts";

// The layout as it was written before the root workspace existed.
const PRE_ROOT_LAYOUT = {
  workspaces: [{
    id: "ws-1",
    title: "Workspace 1",
    activeId: "view-1",
    views: [{
      id: "view-1",
      chatWidthCh: 57,
      explorer: { hidden: false, widthCh: 30 },
      center: { rows: [], activeTabId: "", collapsed: false },
      right: { rows: [], activeTabId: "", collapsed: false },
    }],
  }],
  activeId: "ws-1",
};

// hydrateSession goes through the config bindings, so an in-memory stub is enough to
// observe exactly what it reads and what it writes back.
function stubBindings(
  files: Record<string, unknown>,
): { writes: Record<string, unknown> } {
  const writes: Record<string, unknown> = {};
  (globalThis as Record<string, unknown>).bindings = {
    configRead: ({ name }: { name: string }) =>
      Promise.resolve(files[name] ?? null),
    configWrite: ({ name, data }: { name: string; data: unknown }) => {
      writes[name] = data;
      return Promise.resolve(true);
    },
  };
  return { writes };
}

// The store module keeps a module-level `hydrated` flag and a debounced write timer,
// so this exercises the one transition that matters and tolerates the pending timer.
Deno.test({
  name: "hydrating a pre-root layout persists the adopted tree immediately",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { writes } = stubBindings({
      layout: PRE_ROOT_LAYOUT,
      settings: { workspace: { defaultDir: "~/workspace", gitScanDepth: 3 } },
    });

    await hydrateSession();

    // In memory: the old workspace kept, a root added above it.
    const s = get(session);
    assertEquals(s.root.id, "root");
    assertEquals(s.root.cwd, "~/workspace"); // the old global default became root's
    assertEquals(s.workspaces.map((w) => w.id), ["ws-1"]);
    assertEquals(s.activeId, "ws-1");

    // On disk, without waiting for a user action. This is the regression: the adopted
    // tree used to sit unwritten until the next edit, while settings.json — the only
    // place defaultDir lived — was being rewritten without it.
    const written = writes["layout"] as typeof s | undefined;
    assertEquals(written?.root.id, "root");
    assertEquals(written?.root.cwd, "~/workspace");
    assertEquals(written?.workspaces.map((w) => w.id), ["ws-1"]);
  },
});
