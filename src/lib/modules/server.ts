// The module file server: one loopback port that serves each user module's single HTML
// document. Runs Deno-side.
//
// This server must be started AFTER the frontend's Deno.serve in desktop.ts. deno
// desktop navigates the adopted window to the FIRST served address, so starting this one
// first loads a module's page as the whole app (docs/superpowers/specs/
// 2026-09-02-user-modules-design.md).
//
// A port of its own rather than a path on the frontend's server: a module is code pique
// did not write, and a different origin keeps it out of the app's window — it cannot
// reach `globalThis.bindings` there, only the methods its host relays.
import { assertExtensionName, liveDir } from "../extensions/paths.ts";

// Where a module's document lives: beside the extension file it belongs to, because pi
// auto-discovers `extensions/*.ts` by basename and would not load a directory as an
// extension at all. `namesIn` (extensions/local.ts) lists only `.ts`, so this sibling is
// invisible to the extension listing.
//
// The name is asserted rather than sanitised: this is the only function that turns a
// value from the webview into a path, and a name that does not match is a bug or an
// attack, never something to coerce into a nearby valid one.
export function uiPathFor(name: string): string {
  assertExtensionName(name);
  return `${liveDir()}/${name}.ui.html`;
}

// The request handler. One route, one file, no directory listing and no fallthrough to
// disk: everything else a module needs arrives over the RPC port.
export async function serveModuleUi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // /ui/<name>
  const [, prefix, name, ...rest] = url.pathname.split("/");
  if (prefix !== "ui" || !name || rest.length > 0) {
    return new Response("not found", { status: 404 });
  }

  let path: string;
  try {
    path = uiPathFor(name);
  } catch {
    // A refused name is a 404 rather than a 400, like any other path that is not here.
    return new Response("not found", { status: 404 });
  }

  let html: string;
  try {
    html = await Deno.readTextFile(path);
  } catch {
    return new Response("not found", { status: 404 });
  }

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // An agent rewrites a module in place; a cached copy would hide the rewrite.
      "cache-control": "no-store",
    },
  });
}
