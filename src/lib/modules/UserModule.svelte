<script lang="ts">
  // Host side of a user-contributed module. The module's own HTML runs in a sandboxed
  // iframe served by modules/server.ts, never in this document: it is code pique did not
  // write, and everything in this window can reach `globalThis.bindings` and the -A
  // process behind it.
  //
  // Three properties this component exists to hold, all of them measured rather than
  // assumed (spec: "The frame, measured"):
  //
  // 1. `sandbox="allow-scripts"` with no `allow-same-origin`. The frame's origin is then
  //    opaque: parent.bindings, top.location, parent.document and localStorage all throw
  //    from inside it. Adding allow-same-origin would silently undo the whole design.
  // 2. The frame is addressed by a URL on the module server's port, which serves it
  //    under `default-src 'none'` — the only thing stopping outbound network.
  // 3. `moduleId` and `scope` travel with the CALL, from this component's props. The
  //    frame never sends them and is never asked, so it cannot address another module's
  //    data by lying about who it is.
  import { moduleBindings, moduleUiPort } from "./bindings.ts";
  import { type CallMessage, HANDSHAKE, type ResultMessage } from "./contract.ts";

  let { title, kind, workspaceId }: {
    title: string;
    kind?: string;
    workspaceId?: string;
  } = $props();

  const b = moduleBindings();
  // A module is scoped to the workspace whose view holds it; root is the fallback for a
  // layout that predates workspace ids.
  const scope = $derived(workspaceId ?? "root");
  const moduleId = $derived(kind ?? "");

  let frame: HTMLIFrameElement | undefined = $state();
  // The port was read at hydration (bindings.ts), so the frame has an address on its
  // first render rather than after a round trip.
  const src = $derived(
    moduleUiPort() ? `http://127.0.0.1:${moduleUiPort()}/ui/${scope}/${moduleId}` : "",
  );

  // Hand the frame its port once its document has loaded. Everything it says arrives on
  // that port; nothing it posts on the window is listened to.
  function onLoad() {
    const win = frame?.contentWindow;
    if (!win) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => relay(e.data, channel.port1);
    win.postMessage(HANDSHAKE, "*", [channel.port2]);
  }

  async function relay(msg: unknown, port: MessagePort) {
    const call = msg as CallMessage;
    if (!call || call.t !== "call" || typeof call.id !== "number") return;
    const reply = (ok: boolean, value: unknown) =>
      port.postMessage({ t: "result", id: call.id, ok, value } satisfies ResultMessage);
    if (!b) return reply(false, "no backend");
    try {
      // moduleId and scope come from props, NOT from `call` — see note 3 above.
      reply(true, await b.moduleCall({
        moduleId,
        scope,
        method: call.method,
        payload: call.payload,
      }));
    } catch (e) {
      // A refusal is a normal outcome, not a crash: the panel may show it.
      reply(false, e instanceof Error ? e.message : String(e));
    }
  }
</script>

{#if !b}
  <div class="p-4 text-sm opacity-60">
    {title} is a user module — run the desktop app to load it (bindings are absent in a
    browser tab).
  </div>
{:else if src}
  <!-- sandbox is deliberately allow-scripts ONLY. See note 1. -->
  <iframe
    bind:this={frame}
    {src}
    sandbox="allow-scripts"
    title={title}
    class="h-full w-full border-0 bg-base-100"
    onload={onLoad}
  ></iframe>
{/if}
