import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  isValidSource,
  mergeSearchResults,
  npmSearchUrl,
  toExtInfo,
  toSearchResult,
} from "./packages.ts";
import { packageTypes } from "./catalog.ts";

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
    toExtInfo({
      source: "npm:x",
      scope: "user",
      filtered: false,
      installedPath: "/p",
    }),
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
  assertStringIncludes(
    url,
    encodeURIComponent("keywords:pi-package code review"),
  );
});

Deno.test("npmSearchUrl handles a blank query (keyword only)", () => {
  assertStringIncludes(
    npmSearchUrl("  "),
    encodeURIComponent("keywords:pi-package"),
  );
});

Deno.test("npmSearchUrl ANDs a type keyword onto the pi-package constraint", () => {
  assertStringIncludes(
    npmSearchUrl("memory", "pi-skill"),
    encodeURIComponent("keywords:pi-package,pi-skill memory"),
  );
});

Deno.test("packageTypes reads the kinds a package declares in its npm keywords", () => {
  // The real keyword sets of @dietrichgebert/ponytail and pi-hermes-memory, which
  // pi.dev types "skill" and "extension skill" respectively.
  assertEquals(packageTypes(["ponytail", "pi-package", "pi", "skills"]), [
    "skill",
  ]);
  assertEquals(
    packageTypes(["pi-package", "pi-extension", "memory", "skills"]),
    [
      "extension",
      "skill",
    ],
  );
  assertEquals(packageTypes(["pi-package", "prompt-template", "extension"]), [
    "extension",
    "prompt",
  ]);
  assertEquals(packageTypes(["pi-theme", "dark-theme"]), ["theme"]);
});

Deno.test("packageTypes matches whole keywords, not substrings", () => {
  // Both are real keywords on packages pi.dev leaves untyped.
  assertEquals(packageTypes(["agent-extensions"]), []);
  assertEquals(packageTypes(["red-skills"]), []);
  assertEquals(packageTypes([]), []);
  assertEquals(packageTypes(undefined), []);
});

Deno.test("mergeSearchResults dedupes by source and orders by downloads", () => {
  const hit = (name: string, downloads: number) =>
    toSearchResult({ package: { name }, downloads: { monthly: downloads } });
  assertEquals(
    mergeSearchResults([
      [hit("a", 10), hit("b", 300)],
      [hit("b", 300), hit("c", 200)],
    ]).map((r) => r.name),
    ["b", "c", "a"],
  );
});

Deno.test("toSearchResult projects an npm search object to an install-ready hit", () => {
  assertEquals(
    toSearchResult({
      package: {
        name: "@vigolium/piolium",
        description: "Security audits",
        publisher: { username: "j3ssie" },
        keywords: ["pi-package", "pi-extension"],
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
      types: ["extension"],
    },
  );
});

Deno.test("toSearchResult defaults missing fields", () => {
  assertEquals(
    toSearchResult({ package: { name: "pi-x" } }),
    {
      source: "npm:pi-x",
      name: "pi-x",
      description: "",
      author: "",
      downloads: 0,
      npm: undefined,
      types: [],
    },
  );
});
