import { assertEquals, assertRejects } from "@std/assert";
import { dispatch, type Handlers } from "./broker.ts";
import type { Manifest } from "./capabilities.ts";

const manifest = (caps: Manifest["capabilities"]): Manifest => ({
  kind: "notes",
  label: "Notes",
  capabilities: caps,
});

// Records what actually ran, so a refusal can be shown to have run NOTHING rather than
// to have run something and thrown afterwards.
function recorder() {
  const calls: { method: string; scope: string; payload: unknown }[] = [];
  const handlers: Handlers = {
    kanbanGetBoard: (scope, payload) => {
      calls.push({ method: "kanbanGetBoard", scope, payload });
      return Promise.resolve({ statuses: [] });
    },
    fsRead: (scope, payload) => {
      calls.push({ method: "fsRead", scope, payload });
      return Promise.resolve("contents");
    },
  };
  return { calls, handlers };
}

Deno.test("a granted call reaches its handler and returns its value", async () => {
  const { calls, handlers } = recorder();
  const out = await dispatch(
    manifest({ kanban: true }),
    "ws-1",
    "kanbanGetBoard",
    {},
    handlers,
  );
  assertEquals(out, { statuses: [] });
  assertEquals(calls.length, 1);
});

Deno.test("a refused call never reaches its handler", async () => {
  const { calls, handlers } = recorder();
  await assertRejects(
    () => dispatch(manifest({}), "ws-1", "kanbanGetBoard", {}, handlers),
    Error,
    "not granted",
  );
  assertEquals(calls, []);
});

// The refusal names what was refused: a module author reads this in their own panel,
// and "refused" alone sends them looking in the wrong place.
Deno.test("the refusal names the method", async () => {
  const { handlers } = recorder();
  const err = await assertRejects(
    () => dispatch(manifest({}), "ws-1", "kanbanGetBoard", {}, handlers),
  );
  assertEquals((err as Error).message.includes("kanbanGetBoard"), true);
});

// The scope is the host's, always. A frame cannot reach another workspace's data by
// naming one, because the name it sends is never read.
Deno.test("the handler is given the caller's scope, never one from the payload", async () => {
  const { calls, handlers } = recorder();
  await dispatch(
    manifest({ kanban: true }),
    "ws-1",
    "kanbanGetBoard",
    { scope: "root", moduleId: "other" },
    handlers,
  );
  assertEquals(calls[0].scope, "ws-1");
});

Deno.test("an unknown method is refused before any lookup", async () => {
  const { calls, handlers } = recorder();
  await assertRejects(
    () =>
      dispatch(manifest({ kanban: true }), "ws-1", "termStart", {}, handlers),
    Error,
    "not granted",
  );
  assertEquals(calls, []);
});

// A method the capability check allows but nothing implements is a bug in this file,
// not a refusal — it must not read as "your module lacks permission".
Deno.test("a granted method with no handler fails as unimplemented, not unpermitted", async () => {
  const err = await assertRejects(
    () => dispatch(manifest({ storage: true }), "ws-1", "storageGet", {}, {}),
    Error,
  );
  assertEquals((err as Error).message.includes("not granted"), false);
});

Deno.test("an fs call inside a granted root reaches the handler", async () => {
  const { calls, handlers } = recorder();
  const m = manifest({ fs: { read: ["/home/u/notes"] } });
  await dispatch(m, "ws-1", "fsRead", { path: "/home/u/notes/a.md" }, handlers);
  assertEquals(calls.length, 1);
});

Deno.test("an fs call outside every granted root is refused", async () => {
  const { calls, handlers } = recorder();
  const m = manifest({ fs: { read: ["/home/u/notes"] } });
  await assertRejects(
    () =>
      dispatch(
        m,
        "ws-1",
        "fsRead",
        { path: "/home/u/notes/../secrets" },
        handlers,
      ),
    Error,
    "not granted",
  );
  assertEquals(calls, []);
});
