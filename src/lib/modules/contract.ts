// The message shapes on the port between a user module's frame and its host, shared by
// both sides so neither can drift. No logic: the host half is UserModule.svelte, the
// frame half is whatever the module author writes.
//
// The channel is a MessagePort the host transfers into the frame, not
// `postMessage(…, "*")` on the window. That matters for one reason: the host holds the
// port together with the `moduleId` and scope it was issued for, so a frame has nothing
// to forge — it cannot name a module other than itself, because it never names one at
// all.

// Frame → host. `id` correlates the reply; `method` is checked against the module's
// granted capabilities before anything runs (modules/capabilities.ts).
export type CallMessage = {
  t: "call";
  id: number;
  method: string;
  payload: unknown;
};

// Host → frame. `ok: false` carries a refusal or a handler error, as a string the panel
// may display — never an object that might leak a path or a stack.
export type ResultMessage = {
  t: "result";
  id: number;
  ok: boolean;
  value: unknown;
};

// Host → frame, unsolicited: a board changed, a file moved. Phase 3 wires the source;
// the shape is fixed here so the frame SDK can be written against it now.
export type EventMessage = {
  t: "event";
  topic: string;
  payload: unknown;
};

export type FrameMessage = CallMessage;
export type HostMessage = ResultMessage | EventMessage;

// The single message the host posts on the window (not the port) to hand the port over.
// The frame listens for it, keeps `event.ports[0]`, and speaks only on that afterwards.
export const HANDSHAKE = "pique:module-port";
