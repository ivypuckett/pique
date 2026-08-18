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
      // The board column whose arrivals fire this, or "" for no card trigger.
      kanban?: string;
      // Max concurrent runs of this automaton in this scope; undefined is unlimited.
      wip?: number;
    },
  ): Promise<unknown>;
  automatonsDelete(arg: { scope: string; name: string }): Promise<unknown>;
  // The unattended-firing gate (approval.ts). `automatonsApproved` is the subset of the
  // scope's own definitions that may currently fire on a `cron:` or a card — the badge
  // in the list reads from it, and a definition edited since it was approved drops out
  // of it by itself.
  automatonsApproved(arg: { scope: string }): Promise<string[]>;
  // Every file the approval would cover: the definition, the prompt it sends, and each
  // skill it names. `digest` is what was read, and `automatonsApprove` refuses if the
  // bytes moved since.
  automatonsReview(
    arg: { scope: string; name: string },
  ): Promise<{ files: { path: string; text: string }[]; digest: string }>;
  automatonsApprove(
    arg: { scope: string; name: string; expectDigest: string },
  ): Promise<unknown>;
  automatonsRevokeApproval(
    arg: { scope: string; name: string },
  ): Promise<unknown>;
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
