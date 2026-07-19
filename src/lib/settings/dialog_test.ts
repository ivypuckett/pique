import { assertEquals } from "@std/assert";
import { dirDialogCommand } from "./dialog.ts";

Deno.test("dirDialogCommand builds the kdialog argv", () => {
  assertEquals(dirDialogCommand("kdialog", "/home/me/proj"), {
    cmd: "kdialog",
    args: ["--getexistingdirectory", "/home/me/proj"],
  });
});

Deno.test("dirDialogCommand builds the zenity argv", () => {
  assertEquals(dirDialogCommand("zenity", "/home/me/proj"), {
    cmd: "zenity",
    args: ["--file-selection", "--directory", "--filename=/home/me/proj/"],
  });
});
