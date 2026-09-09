<script lang="ts">
  // Host side of a user-contributed module. The module's own HTML runs in a sandboxed
  // iframe served from the module file server (modules/server.ts), never in this
  // document: it is code pique did not write, and everything in this window can reach
  // `globalThis.bindings` and the -A process behind it.
  //
  // Placeholder for now — the frame and its port handshake arrive with Phase 2 of
  // docs/superpowers/plans/2026-09-02-user-modules.md. Until then a module kind that
  // reaches the registry renders this, which is also what web mode will keep showing:
  // there is no backend to serve the frame from in a plain browser tab.
  import { moduleLabel } from "../layout.ts";

  let { title, kind }: { title: string; kind?: string } = $props();
</script>

<div class="p-4 text-sm opacity-60">
  {kind ? moduleLabel(kind) : title} is a user module — run the desktop app to load it.
</div>
