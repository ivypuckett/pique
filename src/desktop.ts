/// <reference lib="deno.desktop" />
// deno desktop backend entry.
//
// The window MUST be created before any import that pulls in @sigma/pty-ffi, or the
// startup window is not adopted and bindings never attach ("No callback bound").
// So this file has NO static imports — the PTY registry and file-server are loaded
// dynamically below, and we never call win.navigate() (deno desktop auto-navigates
// the adopted window to the address Deno.serve binds to).

const win = new Deno.BrowserWindow({ title: "pique", width: 1200, height: 800 });

const { serveDir } = await import("jsr:@std/http@^1/file-server");
const term = await import("./lib/terminal/pty.ts");

win.bind("termStart", async (arg) => {
  const { cols, rows } = arg as { cols: number; rows: number };
  return { id: term.startSession({ cols, rows }) };
});

win.bind("termWrite", async (arg) => {
  const { id, data } = arg as { id: string; data: string };
  term.writeSession(id, data);
  return true;
});

// Long-poll: resolve as soon as bytes arrive or the shell exits; otherwise return
// empty after 20s so the frontend re-issues the read (bounded, backpressured).
win.bind("termRead", async (arg) => {
  const { id } = arg as { id: string };
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { data, done } = term.readSession(id);
    if (done) return { data: new Uint8Array(0), done: true };
    if (data.length) return { data, done: false };
    await new Promise((r) => setTimeout(r, 15));
  }
  return { data: new Uint8Array(0), done: false };
});

win.bind("termResize", async (arg) => {
  const { id, cols, rows } = arg as { id: string; cols: number; rows: number };
  term.resizeSession(id, cols, rows);
  return true;
});

win.bind("termKill", async (arg) => {
  const { id } = arg as { id: string };
  term.killSession(id);
  return true;
});

// Serve the static Vite build. deno desktop auto-navigates the adopted window here.
Deno.serve((req) => serveDir(req, { fsRoot: "dist", quiet: true }));
