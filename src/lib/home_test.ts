import { assertEquals, assertThrows } from "@std/assert";
import { home } from "./home.ts";

// Both variables have to be restored, not just the one a case sets: HOME is what the
// rest of the suite's temp-home harnesses depend on.
function withEnv(
  env: { HOME?: string; USERPROFILE?: string },
  fn: () => void,
): void {
  const prev = {
    HOME: Deno.env.get("HOME"),
    USERPROFILE: Deno.env.get("USERPROFILE"),
  };
  for (const k of ["HOME", "USERPROFILE"] as const) {
    const v = env[k];
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    fn();
  } finally {
    for (const k of ["HOME", "USERPROFILE"] as const) {
      const v = prev[k];
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("home is $HOME on Linux and macOS", () => {
  withEnv({ HOME: "/home/x" }, () => assertEquals(home(), "/home/x"));
});

Deno.test("home falls back to %USERPROFILE% where HOME is unset", () => {
  withEnv(
    { USERPROFILE: "C:\\Users\\x" },
    () => assertEquals(home(), "C:\\Users\\x"),
  );
});

Deno.test("HOME wins when a Windows shell sets both", () => {
  withEnv(
    { HOME: "/c/Users/x", USERPROFILE: "C:\\Users\\x" },
    () => assertEquals(home(), "/c/Users/x"),
  );
});

Deno.test("home throws when neither is set", () => {
  withEnv({}, () => assertThrows(home, Error, "neither HOME nor USERPROFILE"));
});
