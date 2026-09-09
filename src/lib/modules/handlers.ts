// What each granted capability actually does. Separate from broker.ts so the broker's
// refusal logic can be tested against recording handlers, and separate from desktop.ts
// so these are ordinary functions rather than bind callbacks. Runs Deno-side.
//
// Every handler here takes the scope from its first argument and never looks one up:
// the broker holds the only scope there is, and a handler that resolved its own would
// be a second source of truth for the question this whole design turns on.
import type { Handlers } from "./broker.ts";
import { scopeDir } from "../scope/paths.ts";

// A module's private JSON blob, one file per module per scope. Under the scope dir
// rather than the agent dir: this is the module's own state, not something pi loads.
function storagePath(scope: string, moduleId: string): string {
  return `${scopeDir(scope)}/modules/${moduleId}.json`;
}

// The handler set for one module. Bound to the module's id because storage is per
// module — everything else needs only the scope the broker passes in.
export function handlersFor(moduleId: string): Handlers {
  return {
    // kanban/service.ts is imported at call time, not at module load: desktop.ts loads
    // it lazily for its own weight, and a static import here would drag it into the
    // graph that has to be ready before the first bind is registered.
    kanbanGetBoard: async (scope) => {
      const { board } = await import("../kanban/service.ts");
      return (await board(scope)).getBoard();
    },

    kanbanGetLogs: async (scope, payload) => {
      const { board } = await import("../kanban/service.ts");
      const { cardId } = (payload ?? {}) as { cardId?: string };
      return (await board(scope)).getLogs(cardId);
    },

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
      // The path was checked against the module's granted roots by the broker before
      // this ran. Re-reading it from the payload here is safe for exactly that reason
      // and for no other — do not add a handler that takes a path the broker has not
      // seen, or this comment becomes a lie.
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
