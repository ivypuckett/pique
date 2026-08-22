import { assertEquals, assertThrows } from "@std/assert";
import { devEnv, launchCommand } from "./dev.ts";

Deno.test("devEnv strips the GTK/LD leaks and disables DMA-BUF on Linux", () => {
  const env = devEnv("linux", {
    LD_PRELOAD: "/lib/libfoo.so",
    GTK_PATH: "/usr/lib/gtk-3.0",
    GDK_PIXBUF_MODULE_FILE: "/usr/lib/loaders.cache",
    PATH: "/usr/bin",
  });
  assertEquals(env, {
    PATH: "/usr/bin",
    WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  });
});

Deno.test("devEnv leaves macOS and Windows environments alone", () => {
  // These names are only ever set on such a machine by a POSIX-emulating toolchain, and
  // the app there is WKWebView / WebView2 — clearing them would be meddling, and the
  // DMA-BUF flag would be noise.
  const base = { LD_PRELOAD: "/lib/libfoo.so", PATH: "/usr/bin" };
  assertEquals(devEnv("darwin", base), base);
  assertEquals(devEnv("windows", base), base);
});

Deno.test("devEnv copies rather than mutating the environment it is given", () => {
  const base = { GTK_PATH: "/usr/lib/gtk-3.0" };
  devEnv("linux", base);
  assertEquals(base, { GTK_PATH: "/usr/lib/gtk-3.0" });
});

Deno.test("launchCommand runs the bare executable on Linux", () => {
  assertEquals(
    launchCommand("linux", "pique", ["pique", "pique.so", ".downloaded"]),
    { cmd: "pique/pique", args: [] },
  );
});

Deno.test("launchCommand wants the .exe on Windows", () => {
  assertEquals(launchCommand("windows", "pique", ["pique.exe", "pique.dll"]), {
    cmd: "pique/pique.exe",
    args: [],
  });
});

Deno.test("launchCommand opens an .app bundle on macOS, and runs a bare binary when there is none", () => {
  // Which of the two `deno desktop` emits is unverified — the card that prompted this
  // says so — so both are handled and neither is assumed.
  assertEquals(launchCommand("darwin", "pique", ["pique.app"]), {
    cmd: "open",
    args: ["-W", "pique/pique.app"],
  });
  assertEquals(launchCommand("darwin", "pique", ["pique", "pique.so"]), {
    cmd: "pique/pique",
    args: [],
  });
});

Deno.test("launchCommand names what it found when the launcher is missing", () => {
  assertThrows(
    () => launchCommand("linux", "pique", ["pique.so"]),
    Error,
    "found: pique.so",
  );
  assertThrows(
    () => launchCommand("linux", "pique", []),
    Error,
    "found: nothing",
  );
});
