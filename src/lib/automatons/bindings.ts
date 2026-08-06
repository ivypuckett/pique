// Frontend half of the automatons binding contract. The backend half is the
// automatons* win.bind handlers in src/desktop.ts (delegating to
// automatons/service.ts and automatons/run.ts) — keep arg/return shapes in sync by
// hand (separate module graphs).
import type { AutomatonInfo } from "./service.ts";
import type { RunRecord, RunStatus } from "./run.ts";
import type { ChatEvent, Item } from "../chat/agent.ts";
export type { AutomatonInfo, ChatEvent, Item, RunRecord, RunStatus };

export interface AutomatonBindings {
  // The scope's OWN definitions — the ones it can edit or delete.
  automatonsList(arg: { scope: string }): Promise<AutomatonInfo[]>;
  // Everything launchable there, inherited included.
  automatonsVisible(arg: { scope: string }): Promise<AutomatonInfo[]>;
  automatonsSave(
    arg: {
      scope: string;
      name: string;
      description: string;
      prompt: string;
      extensions: string[];
      skills: string[];
      // Which of pi's builtins the run keeps. Absent and empty are DIFFERENT — absent is
      // every builtin, `[]` is none — so this is passed through rather than defaulted.
      tools?: string[];
      // `provider/model-id`, or "" to inherit the scope's chat default.
      model?: string;
      // A five-field cron expression in local time, or "" for launch-button only.
      cron?: string;
    },
  ): Promise<unknown>;
  automatonsDelete(arg: { scope: string; name: string }): Promise<unknown>;
  automatonsLaunch(
    arg: { scope: string; name: string; args?: string; cwd?: string },
  ): Promise<{ id: string }>;
  // How the UI polls a run's status.
  automatonsRuns(arg: { scope: string }): Promise<RunRecord[]>;
  automatonsHistory(arg: { scope: string; id: string }): Promise<Item[]>;
  automatonsRead(arg: { id: string }): Promise<ChatEvent[]>;
  automatonsStop(arg: { id: string }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend.
export function automatonBindings(): AutomatonBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as AutomatonBindings) : null;
}
