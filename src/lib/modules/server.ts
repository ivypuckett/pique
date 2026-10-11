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
import { assertScopeId, type ScopeId } from "../scope/paths.ts";

// Where a module's document lives: beside the extension file it belongs to, because pi
// auto-discovers `extensions/*.ts` by basename and would not load a directory as an
// extension at all. `namesIn` (extensions/local.ts) lists only `.ts`, so this sibling is
// invisible to the extension listing.
//
// Both ids are asserted rather than sanitised: this is the only function that turns a
// value from the webview into a path, and a name that does not match is a bug or an
// attack, never something to coerce into a nearby valid one.
export function uiPathFor(scope: ScopeId, name: string): string {
  assertScopeId(scope);
  assertExtensionName(name);
  return `${liveDir(scope)}/${name}.ui.html`;
}

// The request handler. One route, one file, no directory listing and no fallthrough to
// disk: everything else a module needs arrives over the RPC port.
export async function serveModuleUi(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // /ui/<scope>/<name>
  const [, prefix, scope, name] = url.pathname.split("/");
  if (prefix !== "ui" || !scope || !name) {
    return new Response("not found", { status: 404 });
  }

  let path: string;
  try {
    path = uiPathFor(scope, name);
  } catch {
    // A refused id is a 404 rather than a 400: the distinction would tell a caller
    // which of the two ids it got wrong.
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
