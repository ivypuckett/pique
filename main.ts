// Entry point for the `deno desktop` app.
//
// `deno desktop` opens a native window pointed at a local HTTP server bound to
// this `Deno.serve()` handler. `Deno.serve()` automatically binds to the
// address the webview navigates to, so no port or hostname is needed here.
//
// Dev:   deno desktop --hmr main.ts
// Build: deno desktop main.ts   ->   ./main  (./main.exe on Windows)

const page = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>hello, ivy</title>
  </head>
  <body>
    hello, ivy
  </body>
</html>
`;

Deno.serve(() =>
  new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
);
