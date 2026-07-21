import { assertEquals } from "@std/assert";
import { parsePorcelain } from "./git.ts";

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
