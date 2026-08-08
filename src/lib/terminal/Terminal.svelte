<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { terminalBindings } from "./bindings.ts";
  import { xtermThemeFromDaisyui } from "./theme.ts";
  import { closeTab } from "../store.ts";
  import { settings } from "../settings/store.ts";

  // Font size at 100%; the UI zoom scales it (see the subscription in onMount).
  const BASE_FONT_SIZE = 13;

  let { title, cwd, argv, autoCloseOnExit, autoFocus, viewId, tabId }: {
    title: string;
    cwd?: string;
    argv?: string[];
    autoCloseOnExit?: boolean;
    autoFocus?: boolean;
    viewId?: string;
    tabId?: string;
  } = $props();
  let host: HTMLDivElement;

  onMount(() => {
    const term = new Terminal({
      fontFamily: "monospace",
      fontSize: BASE_FONT_SIZE,
      cursorBlink: true,
      theme: xtermThemeFromDaisyui(host),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    // Editor tabs open from the file tree and set autoFocus so keystrokes land in the
    // editor right away. Only grab focus when actually visible — a background/restored
    // tab (hidden via display:none) must not steal focus on mount.
    if (autoFocus && host.offsetParent !== null) term.focus();

    // Re-derive the palette when the active daisyui theme changes at runtime.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = xtermThemeFromDaisyui(host);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    const b = terminalBindings();

    let alive = true;
    let id: string | undefined;

    // The terminal paints its own text, so the rem-based UI zoom doesn't reach it —
    // scale the xterm font by the same factor instead. Refit afterwards: a different
    // cell size means a different number of rows and columns, which the pty has to be
    // told about, and once a session is running only this can tell it (the pane's own
    // size hasn't changed, so the ResizeObserver never fires).
    const unzoom = settings.subscribe((s) => {
      const size = BASE_FONT_SIZE * s.appearance.zoom;
      if (term.options.fontSize === size) return;
      term.options.fontSize = size;
      fit.fit();
      if (id) b?.termResize({ id, cols: term.cols, rows: term.rows }).catch(() => {});
    });

    if (!b) {
      term.write("Terminal unavailable — run the desktop app (bindings are not present in a browser tab).\r\n");
      return () => {
        unzoom();
        term.dispose();
      };
    }

    const ro = new ResizeObserver(() => {
      if (!alive || !id) return;
      fit.fit();
      b.termResize({ id, cols: term.cols, rows: term.rows }).catch(() => {});
    });

    (async () => {
      try {
        const started = await b.termStart({ cols: term.cols, rows: term.rows, cwd, argv });
        id = started.id;
        // Unmounted while the session was starting: kill it and stop — the cleanup
        // below already ran with id undefined, so it could not have killed it.
        if (!alive) {
          b.termKill({ id }).catch(() => {});
          return;
        }
        // onData is wired only after id exists, so id is always defined here.
        term.onData((data) => {
          if (alive && id) b.termWrite({ id, data }).catch(() => {});
        });
        ro.observe(host);
        while (alive) {
          const { data, done } = await b.termRead({ id });
          if (!alive) break; // unmounted while parked in the long-poll — do not touch a disposed term
          if (done) {
            // Write the marker first, then try to self-close. If closeTab refuses
            // (editor is the center's last tab, guarded in layout.ts), the tab stays
            // and shows "[session ended]" instead of a frozen, unlabeled screen.
            term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
            if (autoCloseOnExit && viewId && tabId) closeTab(viewId, tabId);
            break;
          }
          if (data.length) term.write(new Uint8Array(data));
        }
      } catch {
        // A binding rejected (e.g. the session was killed during teardown). Stop quietly.
      }
    })();

    return () => {
      alive = false;
      unzoom();
      themeObserver.disconnect();
      ro.disconnect();
      if (id) b.termKill({ id }).catch(() => {});
      term.dispose();
    };
  });
</script>

<div bind:this={host} class="h-full w-full" aria-label={title}></div>
