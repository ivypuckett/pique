// Handing a URL to the desktop's own browser. Deno-side only; invoked via the
// openExternal win.bind in src/desktop.ts.
//
// This is all that is left of the native dialogs: the directory picker used to shell
// out to kdialog or zenity from here, which worked on one desktop of one platform.
// It is now an in-app path box (src/lib/PathInput.svelte) that needs no backend of
// its own beyond the listDir bind.

// Argv for the platform's URL opener, kept pure so it can be unit-tested without one.
// https only: the opener would act on file:// and every other scheme the desktop
// knows, and the only caller has a documentation link.
export function openUrlCommand(
  os: typeof Deno.build.os,
  url: string,
): { cmd: string; args: string[] } {
  if (!url.startsWith("https://")) throw new Error(`not an https URL: ${url}`);
  if (os === "darwin") return { cmd: "open", args: [url] };
  if (os === "linux") return { cmd: "xdg-open", args: [url] };
  throw new Error(`no URL opener for ${os}`);
}

// Open a link in the real browser rather than in pique. The app's webview has no
// address bar and no back button, so following a link in place would strand the user
// on a page they cannot leave. Failures (no opener installed, unsupported platform)
// are swallowed: a documentation link that does not open is not worth an error path.
export async function openUrl(url: string): Promise<void> {
  try {
    const { cmd, args } = openUrlCommand(Deno.build.os, url);
    await new Deno.Command(cmd, { stdout: "null", stderr: "null", args })
      .output();
  } catch {
    // Nothing to fall back to.
  }
}
