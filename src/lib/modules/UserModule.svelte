<script lang="ts">
  // Host side of a user-contributed module. The module's own HTML runs in an iframe
  // served by modules/server.ts, never in this document. The frame is NOT sandboxed — a
  // module is trusted the way an extension is (docs/modules.md) — but it is served from
  // the module server's own port, so it is a different origin from this window and
  // cannot reach `globalThis.bindings` directly; it asks through the port below.
  //
  // `moduleId` and `scope` travel with the CALL, from this component's props. The frame
  // never sends them and is never asked, so its calls are always its own.
  import { moduleBindings, moduleUiPort } from "./bindings.ts";
  import { moduleDef } from "./manifest.ts";
  import { type CallMessage, HANDSHAKE, type ResultMessage } from "./contract.ts";

  let { title, kind, workspaceId }: {
    title: string;
    kind?: string;
    workspaceId?: string;
  } = $props();

  const b = moduleBindings();
  const moduleId = $derived(kind ?? "");
  // The scope that OWNS the module, from the table — not the workspace this view
  // belongs to. A workspace showing one of root's modules addresses root's copy.
  const scope = $derived(moduleDef(moduleId)?.scope ?? workspaceId ?? "root");

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
      // A failed call is a normal outcome, not a crash: the panel may show it.
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
  <iframe
    bind:this={frame}
    {src}
    title={title}
    class="h-full w-full border-0 bg-base-100"
    onload={onLoad}
  ></iframe>
{/if}
