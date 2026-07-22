import { assertEquals } from "@std/assert";
import { resolveKanbanDefaults } from "./service.ts";

Deno.test("resolveKanbanDefaults reads names from settings", () => {
  assertEquals(
    resolveKanbanDefaults({ kanban: { defaultStatuses: [{ name: "A" }, { name: "B" }] } }),
    [{ name: "A" }, { name: "B" }],
  );
});

Deno.test("resolveKanbanDefaults falls back when the section is missing or empty", () => {
  const fallback = resolveKanbanDefaults(null);
  assertEquals(fallback.length > 0, true);
  // Empty/garbage lists fall back too, so a board is never seeded with zero columns.
  assertEquals(resolveKanbanDefaults({ kanban: { defaultStatuses: [] } }), fallback);
  assertEquals(resolveKanbanDefaults({ kanban: { defaultStatuses: [{ x: 1 }] } }), fallback);
});
