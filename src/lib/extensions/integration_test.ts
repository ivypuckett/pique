// The claim the unified gate exists to make, driven through the REAL
// DefaultPackageManager: a fetched package is reviewable as code while still being
// absent from pi's loading set, and enabling flips exactly that and nothing else.
//
// Network-free by using a local-path package source. pi accepts one wherever it
// accepts npm:/git: (verified 2026-08-03), so the whole lifecycle runs against a
// directory we build in the test.
import { assert, assertEquals } from "@std/assert";
import {
  enableExtension,
  listExtensions,
  listVisibleExtensions,
  readExtension,
  removeExtension,
  revokeExtension,
} from "./service.ts";
import { fetchPackage } from "./packages.ts";
import { ROOT } from "../scope/paths.ts";

const ENTRY_SOURCE =
  'export default function (pi) { pi.registerTool({ name: "hello" }); }\n';

// A minimal pi package: a package.json and one auto-discovered extension entry.
async function makePackage(dir: string): Promise<string> {
  const pkg = `${dir}/pkg`;
  await Deno.mkdir(`${pkg}/extensions`, { recursive: true });
  await Deno.writeTextFile(
    `${pkg}/package.json`,
    JSON.stringify({ name: "fixture-pkg", version: "1.0.0" }),
  );
  await Deno.writeTextFile(`${pkg}/extensions/hello.ts`, ENTRY_SOURCE);
  return pkg;
}

async function withTempHome(
  fn: (home: string) => Promise<void>,
): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn(dir);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

Deno.test("a fetched package is reviewable but not yet loaded", async () => {
  await withTempHome(async (home) => {
    const source = await makePackage(home);
    await fetchPackage("ws-1", source);

    const listed = await listExtensions("ws-1");
    assertEquals(listed.length, 1);
    assertEquals(listed[0].origin, "package");
    // The whole point: quarantined, so it is NOT in the set pi loads.
    assertEquals(listed[0].state, "pending");

    // ...and yet the reviewer can read the exact code that would run.
    const review = await readExtension("ws-1", listed[0].id, "pending");
    assertEquals(review.files.length, 1);
    assert(review.files[0].path.endsWith("/extensions/hello.ts"));
    assertEquals(review.files[0].text, ENTRY_SOURCE);
  });
});

Deno.test("enabling a package moves it into pi's loading set", async () => {
  await withTempHome(async (home) => {
    const source = await makePackage(home);
    await fetchPackage("ws-1", source);
    const [pending] = await listExtensions("ws-1");

    await enableExtension("ws-1", pending.id);

    const listed = await listExtensions("ws-1");
    assertEquals(listed.length, 1);
    assertEquals(listed[0].state, "enabled");
    assertEquals(listed[0].origin, "package");
    // pi rewrites a local-path source relative to agentDir on the way into settings,
    // so the id changes here. That is why enable removes the quarantine record by the
    // slug we already hold rather than by matching what settings gave back — and why
    // exactly one row remains instead of a pending/enabled pair.
    //
    // The source that comes back out must be canonicalized to an absolute path: pi
    // resolves a stored local source against agentDir but a supplied one against cwd,
    // so handing the raw stored form back would make revoke silently no-op.
    assertEquals(listed[0].source, source);
  });
});

Deno.test("revoking a package returns it to review without deleting the bytes", async () => {
  await withTempHome(async (home) => {
    const source = await makePackage(home);
    await fetchPackage("ws-1", source);
    await enableExtension("ws-1", (await listExtensions("ws-1"))[0].id);
    const enabled = (await listExtensions("ws-1"))[0];

    await revokeExtension("ws-1", enabled.id);

    const listed = await listExtensions("ws-1");
    assertEquals(listed.length, 1);
    assertEquals(listed[0].state, "pending");
    // The bytes survived, so this is a re-review rather than a re-download.
    const review = await readExtension("ws-1", listed[0].id, "pending");
    assertEquals(review.files[0].text, ENTRY_SOURCE);

    // And a revoked package re-enables cleanly, through pi's normalized source form.
    await enableExtension("ws-1", listed[0].id);
    assertEquals((await listExtensions("ws-1"))[0].state, "enabled");
  });
});

Deno.test("removing a pending package clears it from the list", async () => {
  await withTempHome(async (home) => {
    const source = await makePackage(home);
    await fetchPackage("ws-1", source);
    const [pending] = await listExtensions("ws-1");

    await removeExtension("ws-1", pending.id, "pending");
    assertEquals(await listExtensions("ws-1"), []);
  });
});

// Packages inherit down the scope chain the way local modules do (scopes.md deferred
// #1, now built). The list has to show it: an inherited package is the only explanation
// for a workspace agent holding a tool that workspace never enabled.
Deno.test("root's enabled package is visible to a workspace, labelled as root's", async () => {
  await withTempHome(async (home) => {
    const source = await makePackage(home);
    await fetchPackage(ROOT, source);
    const [pending] = await listExtensions(ROOT);
    await enableExtension(ROOT, pending.id);

    const visible = await listVisibleExtensions("ws-1");

    assertEquals(visible.length, 1);
    assertEquals(visible[0].origin, "package");
    assertEquals(visible[0].state, "enabled");
    // Labelled with the scope that owns it, which is what stops the UI offering
    // Revoke on something this workspace cannot act on.
    assertEquals(visible[0].scope, ROOT);
    // And it stays out of the workspace's OWN list, which is what Library acts on.
    assertEquals(await listExtensions("ws-1"), []);
  });
});
