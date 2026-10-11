import { assertEquals, assertRejects } from "@std/assert";
import { dispatch, type Handlers } from "./broker.ts";
import { type Manifest, METHODS } from "./capabilities.ts";
import { handlersFor } from "./handlers.ts";

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
    storageGet: (scope, payload) => {
      calls.push({ method: "storageGet", scope, payload });
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
    manifest({ storage: true }),
    "ws-1",
    "storageGet",
    {},
    handlers,
  );
  assertEquals(out, { statuses: [] });
  assertEquals(calls.length, 1);
});

Deno.test("a refused call never reaches its handler", async () => {
  const { calls, handlers } = recorder();
  await assertRejects(
    () => dispatch(manifest({}), "ws-1", "storageGet", {}, handlers),
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
    () => dispatch(manifest({}), "ws-1", "storageGet", {}, handlers),
  );
  assertEquals((err as Error).message.includes("storageGet"), true);
});

// The scope is the host's, always. A frame cannot reach another workspace's data by
// naming one, because the name it sends is never read.
Deno.test("the handler is given the caller's scope, never one from the payload", async () => {
  const { calls, handlers } = recorder();
  await dispatch(
    manifest({ storage: true }),
    "ws-1",
    "storageGet",
    { scope: "root", moduleId: "other" },
    handlers,
  );
  assertEquals(calls[0].scope, "ws-1");
});

Deno.test("an unknown method is refused before any lookup", async () => {
  const { calls, handlers } = recorder();
  await assertRejects(
    () =>
      dispatch(manifest({ storage: true }), "ws-1", "termStart", {}, handlers),
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

// The gap this closes: `agentPrompt` shipped in METHODS with no handler behind it, so a
// module could be granted it, the consent screen offered it in the warning group, and
// the call then failed as "not implemented". A consent screen that asks a user to
// approve something that cannot happen is the one defect this feature must not have.
//
// broker_test asserts the DISTINCTION between "not granted" and "not implemented"; this
// asserts nothing real lands in the second bucket. Adding a method to METHODS without a
// handler now fails here rather than in front of a user.
Deno.test("every method the capability table names has a handler behind it", () => {
  const implemented = new Set(Object.keys(handlersFor("notes")));
  const missing = Object.keys(METHODS).filter((m) => !implemented.has(m));
  assertEquals(missing, []);
});

// The other direction is not a bug but is worth knowing: a handler no method names is
// dead code, reachable by nothing, because the capability check runs first.
Deno.test("every handler is reachable through the capability table", () => {
  const named = new Set(Object.keys(METHODS));
  const unreachable = Object.keys(handlersFor("notes")).filter((m) =>
    !named.has(m)
  );
  assertEquals(unreachable, []);
});
