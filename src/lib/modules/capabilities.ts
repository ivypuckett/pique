// What a user module is allowed to ask for. Pure — no Deno APIs, no I/O — so every
// refusal below is cheap to test, and this file is short enough to be read in full by
// whoever has to trust it.
//
// This is the enforcement point, not the consent screen. A manifest the user agreed to
// is only a claim until something checks each call against it, and a displayed-but-
// unenforced capability list would be worse than none: it would put a security promise
// in the UI that the code does not keep.
//
// One thing this file cannot do, and must not be mistaken for doing: it does not stop
// a module reaching the network. Nothing in a broker can — an <img> tag never asks
// permission. That is the CSP's job (modules/server.ts), and the two are independent.
import { isAbsolute, normalize } from "@std/path";

// Grants are named after what a module wants to do, not after the binds they reach:
// the binds are an implementation detail that will be renamed one day, while "may this
// module read the board" is the sentence the consent screen has to show a human.
export type Capabilities = {
  // The board of the scope the module is open in. Read-only for now; a write grant is
  // a separate name, not a truthier `kanban`.
  kanban?: boolean;
  // The module's own JSON blob, private to it and to the scope it runs in.
  storage?: boolean;
  // Absolute directory roots. Each grant is its own list: read does not imply write and
  // write does not imply read, because the pair a module actually needs is usually one
  // of them over a narrower set of paths than the other.
  fs?: { read?: string[]; write?: string[] };
};

export type Manifest = {
  kind: string;
  label: string;
  duplicable?: boolean;
  capabilities: Capabilities;
};

// Every method a module may ever call, and the capability each one needs. A closed set,
// deliberately: a method that is not in this table is refused, so adding a bind to
// desktop.ts does not silently widen what a module can reach. Adding one here is a
// decision, which is the point.
export const METHODS: Record<
  string,
  keyof Capabilities | "fs.read" | "fs.write"
> = {
  kanbanGetBoard: "kanban",
  kanbanGetLogs: "kanban",
  storageGet: "storage",
  storageSet: "storage",
  fsRead: "fs.read",
  fsWrite: "fs.write",
};

// Whether `path` is inside `root`, both resolved first. Compared on a segment boundary
// rather than by prefix: "/home/u/notes-private" starts with "/home/u/notes" and is not
// inside it.
function inside(path: string, root: string): boolean {
  // A relative path has no meaning here — resolving it would silently anchor it to
  // whatever directory the app was launched from.
  if (!isAbsolute(path) || !isAbsolute(root)) return false;
  const p = normalize(path);
  const r = normalize(root).replace(/\/+$/, "");
  return p === r || p.startsWith(`${r}/`);
}

function withinAny(payload: unknown, roots: string[] | undefined): boolean {
  if (!roots || roots.length === 0) return false;
  // The payload came from a frame; it is not to be trusted to have the shape its
  // method implies.
  const path = (payload as { path?: unknown } | null)?.path;
  if (typeof path !== "string" || path === "") return false;
  return roots.some((root) => inside(path, root));
}

// The one question the broker asks before anything runs.
export function allows(
  manifest: Manifest,
  method: string,
  payload: unknown,
): boolean {
  const needs = METHODS[method];
  if (!needs) return false; // closed set: unknown method, no grant
  const caps = manifest.capabilities;
  if (needs === "fs.read") return withinAny(payload, caps.fs?.read);
  if (needs === "fs.write") return withinAny(payload, caps.fs?.write);
  return caps[needs] === true;
}
