<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import { terminalBindings } from "./bindings.ts";

  let { title }: { title: string } = $props();
  let host: HTMLDivElement;

  onMount(() => {
    const term = new Terminal({ fontFamily: "monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

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
        const started = await b.termStart({ cols: term.cols, rows: term.rows });
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
            term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
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
      ro.disconnect();
      if (id) b.termKill({ id }).catch(() => {});
      term.dispose();
    };
  });
</script>

<div bind:this={host} class="h-full w-full" aria-label={title}></div>
