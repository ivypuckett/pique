// Everything a user module can ask pique for, over its port. Separate from desktop.ts so
// these are ordinary functions rather than bind callbacks. Nothing here is gated: a
// module is trusted the way an extension is, and sandboxing one is left to whoever
// wants it (docs/modules.md). Runs Deno-side.
//
// Every handler takes the scope from its first argument: the host component that
// mounted the frame supplies it, never the frame.
import { scopeDir } from "../scope/paths.ts";

export type Handler = (scope: string, payload: unknown) => Promise<unknown>;
export type Handlers = Record<string, Handler>;

// A module's private JSON blob, one file per module per scope. Under the scope dir
// rather than the agent dir: this is the module's own state, not something pi loads.
function storagePath(scope: string, moduleId: string): string {
  return `${scopeDir(scope)}/modules/${moduleId}.json`;
}

// The handler set for one module. Bound to the module's id because storage is per
// module — everything else needs only the scope.
export function handlersFor(moduleId: string): Handlers {
  return {
    storageGet: async (scope) => {
      try {
        return JSON.parse(
          await Deno.readTextFile(storagePath(scope, moduleId)),
        );
      } catch (err) {
        // A module that has never written has no file; that is empty, not an error.
        if (err instanceof Deno.errors.NotFound) return null;
        throw err;
      }
    },

    storageSet: async (scope, payload) => {
      const path = storagePath(scope, moduleId);
      await Deno.mkdir(`${scopeDir(scope)}/modules`, { recursive: true });
      await Deno.writeTextFile(path, JSON.stringify(payload ?? null));
      return true;
    },

    fsRead: async (_scope, payload) => {
      const { path } = payload as { path: string };
      return await Deno.readTextFile(path);
    },

    fsWrite: async (_scope, payload) => {
      const { path, contents } = payload as {
        path: string;
        contents?: unknown;
      };
      await Deno.writeTextFile(path, String(contents ?? ""));
      return true;
    },
  };
}
