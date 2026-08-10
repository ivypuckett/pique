// Backend native directory picker. deno desktop's webview backend exposes no
// folder-dialog API, so we shell out to the platform dialog: kdialog on KDE,
// zenity (GTK) as a fallback. Deno-side only; invoked via the pickDirectory
// win.bind in src/desktop.ts. Returns an absolute path, or null on cancel.

export type Picker = "kdialog" | "zenity";

// Pure argv builder, unit-tested in isolation so the shell-out wrapper stays thin.
// kdialog prints the chosen path on stdout and exits non-zero on cancel; zenity
// behaves the same and takes the start dir as a trailing-slash --filename.
export function dirDialogCommand(picker: Picker, startDir: string): {
  cmd: string;
  args: string[];
} {
  if (picker === "kdialog") {
    return { cmd: "kdialog", args: ["--getexistingdirectory", startDir] };
  }
  return {
    cmd: "zenity",
    args: ["--file-selection", "--directory", `--filename=${startDir}/`],
  };
}

// Run one picker. Cancel (non-zero exit) or empty selection → null. A missing
// binary makes Deno.Command().output() throw, which propagates so pickDirectory
// can try the next picker.
async function runPicker(
  picker: Picker,
  startDir: string,
): Promise<string | null> {
  const { cmd, args } = dirDialogCommand(picker, startDir);
  const out = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!out.success) return null;
  const path = new TextDecoder().decode(out.stdout).trim();
  return path === "" ? null : path;
}

export async function pickDirectory(startDir: string): Promise<string | null> {
  for (const picker of ["kdialog", "zenity"] as const) {
    try {
      return await runPicker(picker, startDir);
    } catch {
      // Binary not installed — fall through to the next picker.
    }
  }
  return null;
}

// Argv for handing a URL to the desktop's own browser. Pure, for the same reason
// dirDialogCommand is. https only: the opener would act on file:// and every other
// scheme the desktop knows, and the only caller has a documentation link.
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
