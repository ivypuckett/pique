// Everything a user module can ask pique for, over its port. Separate from desktop.ts so
// these are ordinary functions rather than bind callbacks. Nothing here is gated: a
// module is trusted the way an extension is, and sandboxing one is left to whoever
// wants it (docs/modules.md). Runs Deno-side.
import { assertExtensionName } from "../extensions/paths.ts";
import { piqueDir } from "../paths.ts";

export type Handler = (payload: unknown) => Promise<unknown>;
export type Handlers = Record<string, Handler>;

// A module's private JSON blob, one file per module. Under ~/.pique rather than the
// agent dir: this is the module's own state, not something pi loads.
function storageDir(): string {
  return `${piqueDir()}/modules`;
}

// The handler set for one module. Bound to the module's id because storage is per
// module — and the id becomes a filename, so it is held to the extension-name rule.
export function handlersFor(moduleId: string): Handlers {
  assertExtensionName(moduleId);
  return {
    storageGet: async () => {
      try {
        return JSON.parse(
          await Deno.readTextFile(`${storageDir()}/${moduleId}.json`),
        );
      } catch (err) {
        // A module that has never written has no file; that is empty, not an error.
        if (err instanceof Deno.errors.NotFound) return null;
        throw err;
      }
    },

    storageSet: async (payload) => {
      await Deno.mkdir(storageDir(), { recursive: true });
      await Deno.writeTextFile(
        `${storageDir()}/${moduleId}.json`,
        JSON.stringify(payload ?? null),
      );
      return true;
    },

    fsRead: async (payload) => {
      const { path } = payload as { path: string };
      return await Deno.readTextFile(path);
    },

    fsWrite: async (payload) => {
      const { path, contents } = payload as {
        path: string;
        contents?: unknown;
      };
      await Deno.writeTextFile(path, String(contents ?? ""));
      return true;
    },
  };
}
