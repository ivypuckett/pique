import { assertEquals, assertThrows } from "@std/assert";
import { assertExtensionName, liveDir, livePath } from "./paths.ts";

function withHome(home: string, fn: () => void): void {
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
  }
}

// pi's own extensions dir, where it discovers every `<name>.ts` itself.
Deno.test("local extensions live in pi's agent dir", () => {
  withHome("/home/x", () => {
    assertEquals(liveDir(), "/home/x/.pi/agent/extensions");
    assertEquals(livePath("my_ext"), "/home/x/.pi/agent/extensions/my_ext.ts");
  });
});

Deno.test("local extension names cannot escape their directory", () => {
  for (
    const bad of [
      "../evil",
      "a/b",
      "/abs",
      "",
      ".",
      "Upper",
      "9lead",
      "has-dash",
      "sp ace",
    ]
  ) {
    assertThrows(
      () => assertExtensionName(bad),
      Error,
      "invalid extension name",
    );
  }
});

Deno.test("local extension names accept lowercase identifiers", () => {
  for (const ok of ["a", "lookup_weather", "ext9", "a_b_c"]) {
    assertExtensionName(ok);
  }
});
