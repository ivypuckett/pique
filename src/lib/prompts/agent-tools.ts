// The agent half of prompt-template authoring: one pi tool that lets an agent write a
// template the user can later invoke as `/name`. The file lands in the quarantine dir
// ONLY (paths.ts) — pi's directory scan does not recurse, so nothing there is invocable
// until a human approves it in Library → Prompts, which moves it into the live dir.
// Passed to createAgentSession as customTools (see chat/agent.ts). Runs Deno-side only.
import { Type } from "typebox";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { promptFile } from "./parse.ts";
import {
  assertPromptName,
  ensurePromptDirs,
  pendingPromptPath,
} from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// Bound to the scope its chat agent runs in: a template an agent defines is quarantined
// in that scope, so approving it in a workspace grants it to that workspace alone. An
// agent in root defines templates every workspace will see — the description says so,
// since the agent should know how far its template will reach.
export function promptAuthoringTools(scope: ScopeId): ToolDefinition[] {
  const reach = scope === ROOT
    ? "This agent runs in the ROOT workspace, so an approved template is available in every workspace."
    : "This agent runs in a single workspace, so an approved template is available only there.";
  return [
    defineTool({
      name: "define_prompt",
      label: "Define a prompt template",
      description:
        "Author a prompt template: a reusable message the user invokes by typing /name in a " +
        "chat. The template does NOT take effect immediately: it is written to a quarantine " +
        "directory and only becomes invocable after the user reviews and approves it in " +
        "Library → Prompts. Say so when reporting back. A template is text that gets sent as " +
        "the user's message, so it is the way to capture a task phrased the same way over and " +
        "over — including the standing instructions a run of that task should start from. " +
        reach,
      parameters: Type.Object({
        name: Type.String({
          description:
            "Template name, lowercase letters/digits/dashes, e.g. review-staged. " +
            "It is both the filename and the token the user types after `/`.",
        }),
        description: Type.String({
          description:
            "One line on what this template does. Shown beside the name in the " +
            "chat's `/` menu.",
        }),
        rationale: Type.String({
          description:
            "Why this template is worth having. Shown to the user when they review " +
            "it, and never included in the prompt itself.",
        }),
        body: Type.String({
          description:
            "The template text, sent as the user's message when invoked. Substitute " +
            "arguments with $1, $2 for positional, $@ or $ARGUMENTS for all of them, and " +
            "${1:-default} to fall back when one is missing.",
        }),
        argumentHint: Type.Optional(Type.String({
          description:
            'The arguments this template expects, e.g. "<file-path>". Shown in the ' +
            "`/` menu. Omit for a template that takes none.",
        })),
      }),
      async execute(_id, p) {
        assertPromptName(p.name);
        await ensurePromptDirs(scope);
        await Deno.writeTextFile(
          pendingPromptPath(scope, p.name),
          promptFile(p),
        );
        return {
          content: [{
            type: "text",
            text:
              `Wrote the prompt template ${p.name} to the pending directory. It is not ` +
              `invocable yet — the user must approve it in Library → Prompts.`,
          }],
          details: null,
        };
      },
    }),
  ];
}
