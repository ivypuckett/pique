import { assertEquals, assertRejects } from "@std/assert";
import { findRepos, gitDiff, parsePorcelain, prefixDiffPaths } from "./git.ts";

Deno.test("parsePorcelain makes changed paths absolute and flags untracked", () => {
  // `git status --porcelain -z`: NUL-terminated "XY <path>" records.
  const out = " M src/a.ts\0?? new.txt\0D  gone.ts\0";
  assertEquals(parsePorcelain(out, "/repo"), [
    { path: "/repo/src/a.ts", untracked: false },
    { path: "/repo/new.txt", untracked: true },
    { path: "/repo/gone.ts", untracked: false },
  ]);
});

Deno.test("parsePorcelain keeps the rename destination and skips the origin record", () => {
  const out = "R  new.ts\0old.ts\0 M other.ts\0";
  assertEquals(parsePorcelain(out, "/repo"), [
    { path: "/repo/new.ts", untracked: false },
    { path: "/repo/other.ts", untracked: false },
  ]);
});

Deno.test("prefixDiffPaths re-roots the header paths of every file section", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-one",
    "+two",
    "",
  ].join("\n");
  assertEquals(
    prefixDiffPaths(diff, "app"),
    [
      "diff --git a/app/src/a.ts b/app/src/a.ts",
      "index 111..222 100644",
      "--- a/app/src/a.ts",
      "+++ b/app/src/a.ts",
      "@@ -1 +1 @@",
      "-one",
      "+two",
      "",
    ].join("\n"),
  );
});

Deno.test("prefixDiffPaths leaves /dev/null and header-lookalike body lines alone", () => {
  // "-- x" removed from the file arrives as "--- x"; re-rooting it would corrupt the hunk.
  const diff = [
    "diff --git a/new.md b/new.md",
    "--- /dev/null",
    "+++ b/new.md",
    "@@ -0,0 +1,2 @@",
    "--- a/decoy",
    "+++ b/decoy",
    "",
  ].join("\n");
  assertEquals(
    prefixDiffPaths(diff, "app"),
    [
      "diff --git a/app/new.md b/app/new.md",
      "--- /dev/null",
      "+++ b/app/new.md",
      "@@ -0,0 +1,2 @@",
      "--- a/decoy",
      "+++ b/decoy",
      "",
    ].join("\n"),
  );
});

Deno.test("prefixDiffPaths with no prefix is a no-op", () => {
  const diff = "diff --git a/a.ts b/a.ts\n";
  assertEquals(prefixDiffPaths(diff, ""), diff);
});

// --- repo discovery and the multi-repo union, against real git repos on disk ---

async function git(dir: string, ...args: string[]): Promise<void> {
  const { code } = await new Deno.Command("git", {
    args,
    cwd: dir,
    stdout: "null",
    stderr: "null",
  }).output();
  assertEquals(code, 0, `git ${args.join(" ")} failed in ${dir}`);
}

// A repo at <root>/<name> with one committed file, then modified in the working tree.
async function seedRepo(root: string, name: string): Promise<void> {
  const dir = `${root}/${name}`;
  await Deno.mkdir(`${dir}/src`, { recursive: true });
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "t");
  await Deno.writeTextFile(`${dir}/src/a.ts`, "one\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-qm", "init");
  await Deno.writeTextFile(`${dir}/src/a.ts`, `two from ${name}\n`);
}

async function withWorkspace(fn: (root: string) => Promise<void>) {
  // realPath because macOS hands out /var/... temp dirs that git reports as /private/var.
  const root = await Deno.realPath(await Deno.makeTempDir());
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("findRepos returns the toplevel when the root is itself a repo", async () => {
  await withWorkspace(async (root) => {
    await seedRepo(root, "solo");
    assertEquals(await findRepos(`${root}/solo/src`), [`${root}/solo`]);
  });
});

Deno.test("findRepos descends a multi-repo root, sorted, skipping hidden dirs", async () => {
  await withWorkspace(async (root) => {
    await seedRepo(root, "beta");
    await seedRepo(root, "alpha");
    await Deno.mkdir(`${root}/.hidden`);
    await Deno.mkdir(`${root}/plain`);
    assertEquals(await findRepos(root), [`${root}/alpha`, `${root}/beta`]);
  });
});

Deno.test("findRepos stops at the depth cap", async () => {
  await withWorkspace(async (root) => {
    await seedRepo(`${root}/a/b`, "deep");
    assertEquals(await findRepos(root, 2), []);
    assertEquals(await findRepos(root, 3), [`${root}/a/b/deep`]);
  });
});

Deno.test("gitDiff unions the repos under a multi-repo root, paths re-rooted", async () => {
  await withWorkspace(async (root) => {
    await seedRepo(root, "beta");
    await seedRepo(root, "alpha");
    const diff = await gitDiff(root, false);
    const headers = diff.split("\n").filter((l) => l.startsWith("diff --git "));
    assertEquals(headers, [
      "diff --git a/alpha/src/a.ts b/alpha/src/a.ts",
      "diff --git a/beta/src/a.ts b/beta/src/a.ts",
    ]);
    assertEquals(diff.includes("+two from alpha"), true);
    assertEquals(diff.includes("+two from beta"), true);
  });
});

Deno.test("gitDiff leaves a single repo's paths untouched", async () => {
  await withWorkspace(async (root) => {
    await seedRepo(root, "solo");
    const diff = await gitDiff(`${root}/solo`, false);
    assertEquals(diff.includes("diff --git a/src/a.ts b/src/a.ts"), true);
  });
});

Deno.test("gitDiff explains a repo-less dir instead of leaking git's usage text", async () => {
  await withWorkspace(async (root) => {
    await Deno.mkdir(`${root}/notes`);
    const err = await assertRejects(() => gitDiff(root, false), Error);
    assertEquals(
      err.message,
      `No git repository in ${root} or the 3 levels below it.`,
    );
    // Depth 0 searches only the root, so the message must not claim otherwise.
    const shallow = await assertRejects(
      () => gitDiff(root, false, undefined, 0),
      Error,
    );
    assertEquals(shallow.message, `No git repository in ${root}.`);
  });
});
