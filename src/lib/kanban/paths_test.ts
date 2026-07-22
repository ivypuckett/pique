import { assertEquals, assertThrows } from "@std/assert";
import { boardPath, boardsDir } from "./paths.ts";

const HOME = Deno.env.get("HOME");

Deno.test("boardsDir is ~/.pique/boards", () => {
  assertEquals(boardsDir(), `${HOME}/.pique/boards`);
});

Deno.test("boardPath keys a db file by workspace id", () => {
  assertEquals(boardPath("ws-1"), `${HOME}/.pique/boards/ws-1.db`);
});

Deno.test("boardPath rejects ids with path separators or traversal", () => {
  assertThrows(() => boardPath("../evil"));
  assertThrows(() => boardPath("a/b"));
  assertThrows(() => boardPath(""));
  assertThrows(() => boardPath("Ws-1")); // must start lowercase alnum
});
