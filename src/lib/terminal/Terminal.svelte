<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { terminalBindings } from "./bindings.ts";
  import { xtermThemeFromDaisyui } from "./theme.ts";
  import { closeTab } from "../store.ts";

  let { title, cwd, argv, autoCloseOnExit, viewId, tabId }: {
    title: string;
    cwd?: string;
    argv?: string[];
    autoCloseOnExit?: boolean;
    viewId?: string;
    tabId?: string;
  } = $props();
  let host: HTMLDivElement;

  onMount(() => {
    const term = new Terminal({
      fontFamily: "monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: xtermThemeFromDaisyui(host),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    // Re-derive the palette when the active daisyui theme changes at runtime.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = xtermThemeFromDaisyui(host);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    const b = terminalBindings();
    if (!b) {
      term.write("Terminal unavailable — run the desktop app (bindings are not present in a browser tab).\r\n");
      return () => term.dispose();
    }

    let alive = true;
    let id: string | undefined;

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
            if (autoCloseOnExit && viewId && tabId) {
              closeTab(viewId, tabId);
            } else {
              term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
            }
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
      themeObserver.disconnect();
      ro.disconnect();
      if (id) b.termKill({ id }).catch(() => {});
      term.dispose();
    };
  });
</script>

<div bind:this={host} class="h-full w-full" aria-label={title}></div>
