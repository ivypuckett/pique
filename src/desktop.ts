/// <reference lib="deno.desktop" />
// deno desktop backend entry.
//
// Two hard-won constraints (both verified end-to-end, both silent when violated):
//
// 1. The window must be created, and ALL win.bind handlers registered, BEFORE any
//    top-level `await`. deno desktop auto-navigates the adopted startup window as soon
//    as the event loop yields; if a binding isn't attached by then, calls to it fail
//    with "No callback bound" and the frontend silently degrades. So we bind first,
//    referencing `term` (assigned after the awaits — handlers only run once the user
//    interacts, long after `term` is populated), then load deps and serve.
// 2. Binding values must be JSON — a `Uint8Array` return throws "invalid type: byte
//    array". PTY output is therefore sent as a plain number array and rebuilt into a
//    Uint8Array on the frontend.

const win = new Deno.BrowserWindow({ title: "pique", width: 1200, height: 800 });

let term: typeof import("./lib/terminal/pty.ts");

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
// `data` is a number array (JSON-safe); the frontend rebuilds a Uint8Array.
win.bind("termRead", async (arg) => {
  const { id } = arg as { id: string };
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { data, done } = term.readSession(id);
    if (done) return { data: [] as number[], done: true };
    if (data.length) return { data: Array.from(data), done: false };
    await new Promise((r) => setTimeout(r, 15));
  }
  return { data: [] as number[], done: false };
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

win.addEventListener("close", () => term?.killAllSessions());

// Bindings are attached; now load deps and serve the static Vite build.
// deno desktop auto-navigates the adopted window to the served address.
term = await import("./lib/terminal/pty.ts");
const { serveDir } = await import("jsr:@std/http@^1/file-server");
Deno.serve((req) => serveDir(req, { fsRoot: "dist", quiet: true }));
