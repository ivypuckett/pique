import { Pty } from "@sigma/pty-ffi";

interface Session {
  pty: Pty;
}

const sessions = new Map<string, Session>();
let counter = 0;

/**
 * What a session should spawn: the caller's `argv` if it gave one, otherwise the user's
 * interactive shell. An `argv[0]` of "$EDITOR" is resolved to $EDITOR.
 *
 * Pure, and parameterised on the platform and environment, because the branches that
 * matter are exactly the ones the developing machine never takes: $SHELL and $EDITOR are
 * POSIX conventions that a stock Windows install leaves unset, so there the fallbacks are
 * not a rare edge — they are the only path.
 */
export function resolveCommand(
  argv: string[] | undefined,
  os: typeof Deno.build.os,
  env: Pick<typeof Deno.env, "get">,
): { cmd: string; args: string[] } {
  const windows = os === "windows";
  if (argv && argv.length > 0) {
    const [first, ...rest] = argv;
    const editor = env.get("EDITOR") ?? (windows ? "notepad.exe" : "vi");
    return { cmd: first === "$EDITOR" ? editor : first, args: rest };
  }
  // ComSpec is Windows' own answer to "which shell", and is always set; powershell is
  // the backstop for a stripped environment. Neither takes -i.
  if (windows) return { cmd: env.get("ComSpec") ?? "powershell.exe", args: [] };
  // -i asks for an interactive shell, which is what a terminal pane wants, and every
  // shell that can be $SHELL accepts it. /bin/sh rather than bash: bash is not
  // guaranteed present (Alpine, a trimmed macOS), /bin/sh is.
  return { cmd: env.get("SHELL") ?? "/bin/sh", args: ["-i"] };
}

/**
 * Spawn a PTY at the given size and cwd; returns a session id.
 */
export function startSession(
  opts: { cols: number; rows: number; cwd?: string; argv?: string[] },
): string {
  const { cmd, args } = resolveCommand(opts.argv, Deno.build.os, Deno.env);
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
