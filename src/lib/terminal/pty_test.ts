import { assertEquals, assertMatch, assertStringIncludes, assertThrows } from "@std/assert";
import {
  killAllSessions,
  killSession,
  readSession,
  resizeSession,
  startSession,
  writeSession,
} from "./pty.ts";

// Non-blocking read is single-shot; drain polls it for up to `ms`.
async function drain(id: string, ms: number): Promise<string> {
  const dec = new TextDecoder(undefined, { fatal: false });
  let out = "";
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { data, done } = readSession(id);
    if (done) break;
    if (data.length) out += dec.decode(data, { stream: true });
    await new Promise((r) => setTimeout(r, 20));
  }
  return out;
}

Deno.test("startSession returns a string id", () => {
  const id = startSession({ cols: 80, rows: 24 });
  try {
    assertEquals(typeof id, "string");
  } finally {
    killSession(id);
  }
});

Deno.test("write + read round-trips shell output", async () => {
  const id = startSession({ cols: 80, rows: 24 });
  try {
    await drain(id, 300); // consume the initial prompt
    writeSession(id, "echo pty-rt-$((3*4))\n");
    const out = await drain(id, 600);
    assertMatch(out, /pty-rt-12/);
  } finally {
    killSession(id);
  }
});

Deno.test("resize is applied — shell reports the new size", async () => {
  const id = startSession({ cols: 80, rows: 24 });
  try {
    await drain(id, 300);
    resizeSession(id, 120, 30);
    writeSession(id, "stty size\n");
    const out = await drain(id, 600);
    assertMatch(out, /30 120/);
  } finally {
    killSession(id);
  }
});

Deno.test("killSession removes the session and is idempotent", () => {
  const id = startSession({ cols: 80, rows: 24 });
  killSession(id);
  assertThrows(() => readSession(id), Error, "unknown terminal session");
  killSession(id); // second kill is a no-op, must not throw
});

Deno.test("killAllSessions closes every session", () => {
  const a = startSession({ cols: 80, rows: 24 });
  const b = startSession({ cols: 80, rows: 24 });
  killAllSessions();
  assertThrows(() => readSession(a), Error, "unknown terminal session");
  assertThrows(() => readSession(b), Error, "unknown terminal session");
  killAllSessions(); // idempotent — no throw when empty
});

Deno.test("unknown id throws a typed error for write/read/resize", () => {
  assertThrows(() => writeSession("nope", "x"), Error, "unknown terminal session");
  assertThrows(() => readSession("nope"), Error, "unknown terminal session");
  assertThrows(() => resizeSession("nope", 80, 24), Error, "unknown terminal session");
});

Deno.test("startSession spawns the shell in the given cwd", async () => {
  const id = startSession({ cols: 80, rows: 24, cwd: "/tmp" });
  writeSession(id, "pwd\n");
  let out = "";
  for (let i = 0; i < 300 && !out.includes("/tmp"); i++) {
    const { data } = readSession(id);
    if (data.length) out += new TextDecoder().decode(data);
    await new Promise((r) => setTimeout(r, 10));
  }
  killSession(id);
  assertStringIncludes(out, "/tmp");
});
