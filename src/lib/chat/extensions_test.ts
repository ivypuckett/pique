import { assert, assertEquals } from "@std/assert";
import { isValidSource, toExtInfo } from "./extensions.ts";

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
