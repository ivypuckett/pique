import { assertEquals } from "@std/assert";
import { drill, normalize, splitPath, suggest } from "./pathpicker.ts";
import type { Entry } from "./fs.ts";

function entry(name: string, isDir = true, isSymlink = false): Entry {
  return { name, path: `/x/${name}`, isDir, isSymlink };
}

Deno.test("splitPath separates the directory to list from the prefix to match", () => {
  assertEquals(splitPath("~/work/pi"), { parent: "~/work/", frag: "pi" });
  assertEquals(splitPath("/home/ivy/"), { parent: "/home/ivy/", frag: "" });
  assertEquals(splitPath("~/"), { parent: "~/", frag: "" });
  assertEquals(splitPath("C:/Users/ivy/pro"), {
    parent: "C:/Users/ivy/",
    frag: "pro",
  });
});

Deno.test("splitPath has nothing to complete without a separator", () => {
  assertEquals(splitPath("~"), null);
  assertEquals(splitPath(""), null);
});

Deno.test("suggest matches the prefix case-insensitively, alphabetically", () => {
  const entries = [entry("Videos"), entry("docs"), entry("Downloads")];
  assertEquals(suggest(entries, "d").map((e) => e.name), [
    "docs",
    "Downloads",
  ]);
  assertEquals(suggest(entries, "DO").map((e) => e.name), [
    "docs",
    "Downloads",
  ]);
});

Deno.test("suggest with an empty fragment offers every directory", () => {
  const entries = [entry("src"), entry("deno.json", false), entry("docs")];
  assertEquals(suggest(entries, "").map((e) => e.name), ["docs", "src"]);
});

Deno.test("suggest offers symlinks, which listDir never marks as directories", () => {
  const entries = [entry("work", false, true), entry("readme.md", false)];
  assertEquals(suggest(entries, "").map((e) => e.name), ["work"]);
});

Deno.test("drill leaves the box ready to complete the next level", () => {
  assertEquals(drill("~/work/", "pique"), "~/work/pique/");
  assertEquals(drill("/", "home"), "/home/");
});

Deno.test("normalize drops the trailing slash drilling leaves behind", () => {
  assertEquals(normalize("~/work/pique/"), "~/work/pique");
  assertEquals(normalize("  ~/work  "), "~/work");
  assertEquals(normalize(""), "");
});

Deno.test("normalize keeps the root's slash, which is the whole path", () => {
  assertEquals(normalize("/"), "/");
});
