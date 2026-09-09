import { assertEquals } from "@std/assert";
import {
  isDuplicable,
  MODULES,
  moduleDef,
  type ModuleDef,
  railGroups,
  setInstalledModules,
} from "./manifest.ts";

const def = (kind: string, label: string, duplicable = false): ModuleDef => ({
  kind,
  label,
  key: "",
  duplicable,
});

// Every test resets: the table is process-wide, and a leaked entry would make the
// next test pass or fail for a reason that is not in it.
function withInstalled(defs: ModuleDef[], fn: () => void) {
  setInstalledModules(defs);
  try {
    fn();
  } finally {
    setInstalledModules([]);
  }
}

Deno.test("with nothing installed, the table is exactly the built-ins", () => {
  setInstalledModules([]);
  assertEquals(railGroups().length, MODULES.length + 1); // + the editor row
  assertEquals(moduleDef("kanban")?.label, "Kanban");
  assertEquals(moduleDef("notes"), undefined);
});

Deno.test("an installed module is a module in every respect", () => {
  withInstalled([def("notes", "Notes", true)], () => {
    assertEquals(moduleDef("notes")?.label, "Notes");
    assertEquals(isDuplicable("notes"), true);
    assertEquals(railGroups().includes("notes"), true);
  });
});

// A built-in must never be shadowed by an install: the kind decides which component
// renders, and letting an install win would let it replace Chat or Kanban.
Deno.test("a built-in kind wins a collision with an installed one", () => {
  withInstalled([def("kanban", "Not Kanban", true)], () => {
    assertEquals(moduleDef("kanban")?.label, "Kanban");
    assertEquals(isDuplicable("kanban"), false);
  });
});

Deno.test("installed modules come after the built-ins on the rail", () => {
  withInstalled([def("notes", "Notes")], () => {
    const groups = railGroups();
    assertEquals(groups[0], "editor");
    assertEquals(groups[groups.length - 1], "notes");
  });
});

// The chord is a fixed namespace (decision 9). An installed module carrying a `key`
// must not be reachable by it, or an install could shadow ctrl+t k.
Deno.test("installed modules contribute no chord letters", () => {
  withInstalled([{ kind: "notes", label: "Notes", key: "k" }], () => {
    assertEquals(MODULES.some((m) => m.kind === "notes"), false);
  });
});

Deno.test("an unknown kind stays a singleton", () => {
  setInstalledModules([]);
  assertEquals(isDuplicable("whatever"), false);
});
