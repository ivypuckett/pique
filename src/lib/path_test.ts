import { assertEquals } from "@std/assert";
import { toWebPath } from "./path.ts";

Deno.test("toWebPath rewrites Windows separators for the webview", () => {
  assertEquals(
    toWebPath("C:\\Users\\x\\proj\\a.ts", "windows"),
    "C:/Users/x/proj/a.ts",
  );
});

// The mixed case is the one the file tree actually sees: a workspace root from the
// native folder picker (backslashed) with segments appended by pique (forward).
Deno.test("toWebPath normalizes a mixed path to one separator", () => {
  assertEquals(toWebPath("C:\\proj/src\\a.ts", "windows"), "C:/proj/src/a.ts");
});

Deno.test("toWebPath leaves an already-forward-slashed path alone", () => {
  assertEquals(toWebPath("C:/proj/a.ts", "windows"), "C:/proj/a.ts");
});

// `\` is a legal character in a POSIX filename, so rewriting it there would rename the
// file out from under the tree.
Deno.test("toWebPath does not touch a backslash on POSIX", () => {
  assertEquals(
    toWebPath("/home/x/od\\d name.ts", "linux"),
    "/home/x/od\\d name.ts",
  );
});
