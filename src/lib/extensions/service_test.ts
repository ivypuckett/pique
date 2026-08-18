import { assertEquals, assertThrows } from "@std/assert";
import {
  enableExtension,
  type Extension,
  extensionId,
  extensionLoadErrors,
  listExtensions,
  listVisibleExtensions,
  parseId,
  readExtension,
  removeExtension,
  revokeExtension,
} from "./service.ts";
import { enableLocal } from "./local.ts";
import {
  ensureExtensionDirs,
  pendingPackagePath,
  pendingPath,
} from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// A module that really does import and register, so "loads" vs "does not load" is a
// distinction the loader draws rather than one the fixture asserts.
const HEALTHY_EXTENSION =
  `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fixture_tool",
    label: "fixture_tool",
    description: "service fixture",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: null };
    },
  });
}
`;

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function seedLocal(
  scope: ScopeId,
  name: string,
  source = "// src",
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(pendingPath(scope, name), source);
}

// Seed the quarantine record directly rather than fetching: listing must not care how
// the bytes got there, and this keeps the test off the network.
async function seedPendingPackage(
  scope: ScopeId,
  source: string,
): Promise<void> {
  await ensureExtensionDirs(scope);
  await Deno.writeTextFile(
    pendingPackagePath(scope, source),
    JSON.stringify({ source, requestedAt: "2026-08-03T00:00:00.000Z" }),
  );
}

const summary = (list: Extension[]) =>
  list.map((e) => ({
    id: e.id,
    origin: e.origin,
    state: e.state,
    scope: e.scope,
  }));

Deno.test("ids split on the first colon, so a package source keeps its own", () => {
  assertEquals(parseId(extensionId("package", "npm:pi-crew")), {
    origin: "package",
    key: "npm:pi-crew",
  });
  assertEquals(parseId(extensionId("local", "my_ext")), {
    origin: "local",
    key: "my_ext",
  });
  assertThrows(() => parseId("my_ext"), Error, "invalid extension id");
  assertThrows(() => parseId("bogus:x"), Error, "invalid extension id");
});

Deno.test("an empty scope lists nothing of either origin", async () => {
  await withTempHome(async () => {
    assertEquals(await listExtensions("ws-1"), []);
  });
});

Deno.test("both origins appear in one list, pending before enabled", async () => {
  await withTempHome(async () => {
    await seedPendingPackage("ws-1", "npm:pi-crew");
    await seedLocal("ws-1", "mine");
    await seedLocal("ws-1", "live_one");
    await enableLocal("ws-1", "live_one");

    assertEquals(summary(await listExtensions("ws-1")), [
      {
        id: "package:npm:pi-crew",
        origin: "package",
        state: "pending",
        scope: "ws-1",
      },
      { id: "local:mine", origin: "local", state: "pending", scope: "ws-1" },
      {
        id: "local:live_one",
        origin: "local",
        state: "enabled",
        scope: "ws-1",
      },
    ]);
  });
});

Deno.test("reviewing a local extension returns the one file that would run", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "my_ext", "// the source");
    const src = await readExtension("ws-1", "local:my_ext", "pending");
    assertEquals(src.files, [{ path: "my_ext.ts", text: "// the source" }]);
    assertEquals(src.skills, []);
    assertEquals(src.truncated, false);
  });
});

Deno.test("enable and revoke move a local extension between the two states", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "my_ext");

    const { digest } = await readExtension("ws-1", "local:my_ext", "pending");
    await enableExtension("ws-1", "local:my_ext", digest);
    assertEquals(summary(await listExtensions("ws-1")), [
      { id: "local:my_ext", origin: "local", state: "enabled", scope: "ws-1" },
    ]);

    // Revoke returns it to review rather than deleting it.
    await revokeExtension("ws-1", "local:my_ext");
    assertEquals(summary(await listExtensions("ws-1")), [
      { id: "local:my_ext", origin: "local", state: "pending", scope: "ws-1" },
    ]);

    await removeExtension("ws-1", "local:my_ext", "pending");
    assertEquals(await listExtensions("ws-1"), []);
  });
});

Deno.test("a workspace sees root's enabled local extensions before its own", async () => {
  await withTempHome(async () => {
    await seedLocal(ROOT, "shared");
    await enableLocal(ROOT, "shared");
    await seedLocal("ws-1", "mine");

    assertEquals(summary(await listVisibleExtensions("ws-1")), [
      { id: "local:shared", origin: "local", state: "enabled", scope: ROOT },
      { id: "local:mine", origin: "local", state: "pending", scope: "ws-1" },
    ]);
  });
});

Deno.test("root's pending local extensions are not visible to a workspace", async () => {
  await withTempHome(async () => {
    await seedLocal(ROOT, "not_yet");
    assertEquals(await listVisibleExtensions("ws-1"), []);
  });
});

// The asymmetry the merged list has to be honest about: local extensions are inherited
// from root, packages are not (see docs/extensions.md).
Deno.test("root's packages AWAITING REVIEW are not inherited", async () => {
  await withTempHome(async () => {
    // Enabled packages do inherit (integration_test.ts); a quarantined one is not
    // enabled anywhere, so it reaches nobody.
    await seedPendingPackage(ROOT, "npm:pi-crew");
    assertEquals(await listVisibleExtensions("ws-1"), []);
  });
});

Deno.test("a malformed pending record is skipped, not fatal", async () => {
  await withTempHome(async () => {
    await ensureExtensionDirs("ws-1");
    await Deno.writeTextFile(
      pendingPackagePath("ws-1", "npm:broken"),
      "{ not json",
    );
    await seedPendingPackage("ws-1", "npm:fine");

    assertEquals(summary(await listExtensions("ws-1")), [
      {
        id: "package:npm:fine",
        origin: "package",
        state: "pending",
        scope: "ws-1",
      },
    ]);
  });
});

Deno.test("a pending record that lost its source falls back to the filename", async () => {
  await withTempHome(async () => {
    await ensureExtensionDirs("ws-1");
    await Deno.writeTextFile(
      pendingPackagePath("ws-1", "npm:@scope/pkg"),
      "{}",
    );
    assertEquals((await listExtensions("ws-1"))[0].source, "npm:@scope/pkg");
  });
});

// ---------------------------------------------------------------------------
// The review-to-enable window. A Library tab stays open indefinitely, and the chat
// agent has `write` — so "reviewed at 09:00, enabled at 17:00" is a real sequence, and
// the bytes in between are not necessarily the ones that were read.
// ---------------------------------------------------------------------------

Deno.test("enabling with the digest that was reviewed succeeds", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "steady", "// the reviewed source");
    const reviewed = await readExtension("ws-1", "local:steady", "pending");

    await enableExtension("ws-1", "local:steady", reviewed.digest);

    const enabled = (await listExtensions("ws-1")).find((e) =>
      e.name === "steady"
    );
    assertEquals(enabled?.state, "enabled");
  });
});

Deno.test("enabling refuses a source that changed after it was reviewed", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "swapped", "// the reviewed source");
    const reviewed = await readExtension("ws-1", "local:swapped", "pending");

    // What an agent with `write` can do while the tab sits open.
    await Deno.writeTextFile(
      pendingPath("ws-1", "swapped"),
      "// something else entirely",
    );

    let message = "";
    try {
      await enableExtension("ws-1", "local:swapped", reviewed.digest);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    assertEquals(
      message.includes("changed on disk"),
      true,
      `the enable must be refused, got: ${message || "no error"}`,
    );
    const after = (await listExtensions("ws-1")).find((e) =>
      e.name === "swapped"
    );
    assertEquals(
      after?.state,
      "pending",
      "and it must still be awaiting review, not enabled",
    );
  });
});

Deno.test("the digest covers the full source, not the truncated display", async () => {
  await withTempHome(async () => {
    // Longer than MAX_REVIEW_BYTES, differing only past the clamp: a digest taken over
    // the displayed text would call these two identical and let the swap through.
    const head = "//" + "x".repeat(200_000);
    await seedLocal("ws-1", "long", head + "// before");
    const reviewed = await readExtension("ws-1", "local:long", "pending");
    assertEquals(reviewed.truncated, true, "precondition: display is clamped");

    await Deno.writeTextFile(pendingPath("ws-1", "long"), head + "// after");
    let refused = false;
    try {
      await enableExtension("ws-1", "local:long", reviewed.digest);
    } catch {
      refused = true;
    }
    assertEquals(refused, true, "a change past the clamp must still be caught");
  });
});

Deno.test("enabling without a digest is refused", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "direct", "// src");

    // The webview is an untrusted caller and can omit the argument entirely, so the
    // refusal has to be a runtime check and not just a required parameter.
    let message = "";
    try {
      await (enableExtension as (s: string, i: string) => Promise<void>)(
        "ws-1",
        "local:direct",
      );
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    assertEquals(
      message.includes("without reviewing"),
      true,
      `the enable must be refused, got: ${message || "no error"}`,
    );

    const after = (await listExtensions("ws-1")).find((e) =>
      e.name === "direct"
    );
    assertEquals(after?.state, "pending");
  });
});

// ---------------------------------------------------------------------------
// Load failures. An extension that will not import is still `enabled` by this module's
// invariant, so the list alone cannot distinguish it from one that works.
// ---------------------------------------------------------------------------

Deno.test("a broken enabled extension is reported, a healthy one is not", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "healthy", HEALTHY_EXTENSION);
    await enableLocal("ws-1", "healthy");
    await seedLocal("ws-1", "broken", "this is not valid typescript ((((");
    await enableLocal("ws-1", "broken");

    const errors = await extensionLoadErrors("ws-1");

    assertEquals(
      errors.map((e) => e.name),
      ["broken"],
      "only the one that cannot load is named",
    );
    assertEquals(
      errors[0].error.length > 0,
      true,
      "with a reason to show the user",
    );
  });
});

Deno.test("a scope whose extensions all load reports nothing", async () => {
  await withTempHome(async () => {
    await seedLocal("ws-1", "fine", HEALTHY_EXTENSION);
    await enableLocal("ws-1", "fine");
    assertEquals(await extensionLoadErrors("ws-1"), []);
  });
});
