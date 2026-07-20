import { Pty } from "@sigma/pty-ffi";

interface Session {
  pty: Pty;
}

const sessions = new Map<string, Session>();
let counter = 0;

/**
 * Spawn a PTY at the given size and cwd; returns a session id.
 * Default: the user's interactive shell. If `argv` is given, spawn that command
 * instead — an `argv[0]` of "$EDITOR" is resolved to $EDITOR (fallback "vi").
 */
export function startSession(
  opts: { cols: number; rows: number; cwd?: string; argv?: string[] },
): string {
  let cmd: string;
  let args: string[];
  if (opts.argv && opts.argv.length > 0) {
    const [first, ...rest] = opts.argv;
    cmd = first === "$EDITOR" ? (Deno.env.get("EDITOR") ?? "vi") : first;
    args = rest;
  } else {
    cmd = Deno.env.get("SHELL") ?? "bash";
    args = ["-i"];
  }
  const pty = new Pty(cmd, {
    args,
    env: { TERM: "xterm-256color" },
    cwd: opts.cwd,
    size: { rows: opts.rows, cols: opts.cols },
  });
  const id = `t${++counter}`;
  sessions.set(id, { pty });
  return id;
}

function mustGet(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error(`unknown terminal session: ${id}`);
  return s;
}

/** Forward keystrokes/paste to the shell. */
export function writeSession(id: string, data: string): void {
  mustGet(id).pty.write(data);
}

/** Non-blocking single read. On process exit, closes and forgets the session. */
export function readSession(id: string): { data: Uint8Array; done: boolean } {
  const s = mustGet(id);
  const { data, done } = s.pty.readBytes();
  if (done) {
    s.pty.close();
    sessions.delete(id);
  }
  return { data, done };
}

/** Resize the PTY (sends SIGWINCH to the foreground process group). */
export function resizeSession(id: string, cols: number, rows: number): void {
  mustGet(id).pty.resize({ rows, cols });
}

/** Close and forget a session. Idempotent — unknown/closed ids are a no-op. */
export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.pty.close();
  sessions.delete(id);
}

/** Close and forget every session. Called on window close so no shells orphan. */
export function killAllSessions(): void {
  for (const s of sessions.values()) s.pty.close();
  sessions.clear();
}
