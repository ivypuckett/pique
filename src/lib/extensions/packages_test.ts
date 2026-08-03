import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { isValidSource, npmSearchUrl, toExtInfo, toSearchResult } from "./packages.ts";

Deno.test("isValidSource accepts pi source forms", () => {
  for (
    const s of [
      "npm:pkg",
      "npm:@scope/pkg@1.2.3",
      "git:github.com/u/r@v1",
      "https://github.com/u/r",
      "ssh://git@github.com/u/r",
      "git@github.com:u/r",
      "/abs/path",
      "./rel",
      "../rel",
      "  npm:pkg  ",
    ]
  ) {
    assert(isValidSource(s), `expected valid: ${JSON.stringify(s)}`);
  }
});

Deno.test("isValidSource rejects blank and bare names", () => {
  for (const s of ["", "   ", "just-a-name", "pkg@1.0.0", "@scope/pkg"]) {
    assert(!isValidSource(s), `expected invalid: ${JSON.stringify(s)}`);
  }
});

Deno.test("toExtInfo maps a ConfiguredPackage with an installed path", () => {
  assertEquals(
    toExtInfo({ source: "npm:x", scope: "user", filtered: false, installedPath: "/p" }),
    { source: "npm:x", scope: "user", path: "/p" },
  );
});

Deno.test("toExtInfo omits a missing installed path", () => {
  assertEquals(
    toExtInfo({ source: "git:y", scope: "user", filtered: false }),
    { source: "git:y", scope: "user", path: undefined },
  );
});

Deno.test("npmSearchUrl constrains to the pi-package keyword and encodes the query", () => {
  const url = npmSearchUrl("code review");
  assertStringIncludes(url, "registry.npmjs.org/-/v1/search");
  assertStringIncludes(url, encodeURIComponent("keywords:pi-package code review"));
});

Deno.test("npmSearchUrl handles a blank query (keyword only)", () => {
  assertStringIncludes(npmSearchUrl("  "), encodeURIComponent("keywords:pi-package"));
});

Deno.test("toSearchResult projects an npm search object to an install-ready hit", () => {
  assertEquals(
    toSearchResult({
      package: {
        name: "@vigolium/piolium",
        description: "Security audits",
        publisher: { username: "j3ssie" },
        links: { npm: "https://www.npmjs.com/package/@vigolium/piolium" },
      },
      downloads: { monthly: 281697 },
    }),
    {
      source: "npm:@vigolium/piolium",
      name: "@vigolium/piolium",
      description: "Security audits",
      author: "j3ssie",
      downloads: 281697,
      npm: "https://www.npmjs.com/package/@vigolium/piolium",
    },
  );
});

Deno.test("toSearchResult defaults missing fields", () => {
  assertEquals(
    toSearchResult({ package: { name: "pi-x" } }),
    { source: "npm:pi-x", name: "pi-x", description: "", author: "", downloads: 0, npm: undefined },
  );
});
