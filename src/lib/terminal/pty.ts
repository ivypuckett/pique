import { Pty } from "@sigma/pty-ffi";

interface Session {
  pty: Pty;
}

const sessions = new Map<string, Session>();
let counter = 0;

/** Spawn the user's shell in a PTY at the given size; returns a session id. */
export function startSession(opts: { cols: number; rows: number }): string {
  const shell = Deno.env.get("SHELL") ?? "bash";
  const pty = new Pty(shell, {
    args: ["-i"],
    env: { TERM: "xterm-256color" },
    size: { rows: opts.rows, cols: opts.cols },
  });
  const id = `t${++counter}`;
  sessions.set(id, { pty });
  return id;
}

function require(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error(`unknown terminal session: ${id}`);
  return s;
}

/** Forward keystrokes/paste to the shell. */
export function writeSession(id: string, data: string): void {
  require(id).pty.write(data);
}

/** Non-blocking single read. On process exit, closes and forgets the session. */
export function readSession(id: string): { data: Uint8Array; done: boolean } {
  const s = require(id);
  const { data, done } = s.pty.readBytes();
  if (done) {
    s.pty.close();
    sessions.delete(id);
  }
  return { data, done };
}

/** Resize the PTY (sends SIGWINCH to the foreground process group). */
export function resizeSession(id: string, cols: number, rows: number): void {
  require(id).pty.resize({ rows, cols });
}

/** Close and forget a session. Idempotent — unknown/closed ids are a no-op. */
export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.pty.close();
  sessions.delete(id);
}
