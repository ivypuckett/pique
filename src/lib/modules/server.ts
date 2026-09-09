// The module file server: one loopback port that serves each user module's single HTML
// document, under the header that is this app's only network control. Runs Deno-side.
//
// Two constraints from the frame spike (docs/superpowers/specs/2026-09-02-user-modules-design.md),
// both silent when violated:
//
// 1. This server must be started AFTER the frontend's Deno.serve in desktop.ts. deno
//    desktop navigates the adopted window to the FIRST served address, so starting this
//    one first loads a module's page as the whole app.
// 2. The CSP is not defence in depth. A sandboxed frame without it reached a recording
//    server through six separate channels, so `default-src 'none'` is the thing standing
//    between a module that can read files and a module that can post them somewhere.
import { assertExtensionName, liveDir } from "../extensions/paths.ts";
import { assertScopeId, type ScopeId } from "../scope/paths.ts";

// A module is ONE html document with its script and style inlined. `'self'` is
// deliberately absent: the frame's origin is opaque, so `'self'` matches nothing and a
// module cannot load its own `app.js` even from the port that served its HTML. This was
// measured against a no-CSP control rather than reasoned about.
export function modulePolicy(): string {
  return "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";
}

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
// disk: everything else a module needs arrives over the RPC port, because an opaque
// origin cannot fetch even this server.
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
      "content-security-policy": modulePolicy(),
      // Belt to the CSP's braces: nothing here should ever be cached across an enable
      // and a revoke.
      "cache-control": "no-store",
    },
  });
}
