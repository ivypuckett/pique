// The package lifecycle driven through the REAL DefaultPackageManager: an installed
// package is in pi's loading set, its code is readable from its row, and removing it
// takes it out again.
//
// Network-free by using a local-path package source. pi accepts one wherever it
// accepts npm:/git: (verified 2026-08-03), so the whole lifecycle runs against a
// directory we build in the test.
import { assert, assertEquals } from "@std/assert";
import {
  installPackage,
  listExtensions,
  readExtension,
  removeExtension,
} from "./service.ts";

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

Deno.test("an installed package is listed, and its code is readable", async () => {
  await withTempHome(async (home) => {
    const source = await makePackage(home);
    await installPackage(source);

    const listed = await listExtensions();
    assertEquals(listed.length, 1);
    assertEquals(listed[0].origin, "package");
    // pi rewrites a local-path source relative to agentDir on the way into settings.
    // The source that comes back out must be canonicalized to an absolute path: pi
    // resolves a stored local source against agentDir but a supplied one against cwd,
    // so handing the raw stored form back would make remove silently no-op.
    assertEquals(listed[0].source, source);

    const read = await readExtension(listed[0].id);
    assertEquals(read.files.length, 1);
    assert(read.files[0].path.endsWith("/extensions/hello.ts"));
    assertEquals(read.files[0].text, ENTRY_SOURCE);
  });
});

Deno.test("removing a package clears it from the list", async () => {
  await withTempHome(async (home) => {
    const source = await makePackage(home);
    await installPackage(source);
    const [pkg] = await listExtensions();

    await removeExtension(pkg.id);
    assertEquals(await listExtensions(), []);
  });
});
