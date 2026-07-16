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

    let id: string | undefined;
    let alive = true;

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (id) b.termResize({ id, cols: term.cols, rows: term.rows });
    });

    (async () => {
      const started = await b.termStart({ cols: term.cols, rows: term.rows });
      id = started.id;
      term.onData((data) => b!.termWrite({ id: id!, data }));
      ro.observe(host);
      while (alive) {
        const { data, done } = await b.termRead({ id });
        if (done) {
          term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
          break;
        }
        if (data.length) term.write(data);
      }
    })();

    return () => {
      alive = false;
      ro.disconnect();
      if (id) b.termKill({ id });
      term.dispose();
    };
  });
</script>

<div bind:this={host} class="h-full w-full" title={title}></div>
