// The agent half of subagents: two pi tools bound to the scope its chat agent runs in.
// define_subagent writes a definition straight to the live dir (paths.ts) — no
// pending/review step, unlike define_prompt/define_extension; see paths.ts for why.
// run_subagent delegates a task to one, running it as an isolated nested session
// (service.ts). Passed to createAgentSession as customTools (see chat/agent.ts).
// Runs Deno-side only.
import { Type } from "typebox";
import {
  defineTool,
  type ModelRuntime,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { listVisibleAgents, runSubagent } from "./service.ts";
import { agentFile } from "./parse.ts";
import { agentPath, assertAgentName, ensureAgentDirs } from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

function text(
  value: string,
): { content: { type: "text"; text: string }[]; details: null } {
  return { content: [{ type: "text", text: value }], details: null };
}

// Bound to the scope its chat agent runs in: a subagent defined here is written into
// that scope, so it is available to run_subagent calls from that scope and (if it is
// root) every workspace beneath it.
export function subagentTools(
  scope: ScopeId,
  cwd: string,
  modelRuntime: ModelRuntime,
  // deno-lint-ignore no-explicit-any
  fallbackModel: any,
  // The list at session start, for the run_subagent tool's description only — enough
  // for the model to see what already exists without a separate list call. The lookup
  // inside execute() re-reads from disk every time, so a subagent defined mid-conversation
  // (by define_subagent, or by hand) is usable immediately, in the same turn, without a
  // reload or a new session.
  initialAgents: { name: string; description: string }[],
): ToolDefinition[] {
  const list = initialAgents.length === 0
    ? "none defined"
    : initialAgents.map((a) => `${a.name}: ${a.description}`).join("\n");
  const reach = scope === ROOT
    ? "This agent runs in the ROOT workspace, so a defined subagent is available in every workspace."
    : "This agent runs in a single workspace, so a defined subagent is available only there.";

  return [
    defineTool({
      name: "run_subagent",
      label: "Run a subagent",
      description:
        "Delegate a task to a named subagent: it runs in its own isolated session, " +
        "with its own system prompt and (optionally) its own restricted tool set and " +
        "model, and reports back its final answer as text. Use it to hand off " +
        "self-contained work that benefits from a narrower focus or a cheaper/faster " +
        "model, e.g. fast read-only recon. Available at the start of this conversation " +
        "(name: description) — define_subagent may have added more since:\n" +
        list,
      parameters: Type.Object({
        agent: Type.String({ description: "The subagent's name." }),
        task: Type.String({
          description:
            "The task to delegate, as a complete, self-contained instruction — the " +
            "subagent sees nothing of this conversation beyond what is written here.",
        }),
      }),
      async execute(_id, p, signal) {
        const agents = await listVisibleAgents(scope);
        const def = agents.find((a) => a.name === p.agent);
        if (!def) {
          throw new Error(
            `no subagent named "${p.agent}". Available: ${
              agents.map((a) => a.name).join(", ") || "none"
            }`,
          );
        }
        const result = await runSubagent({
          def,
          task: p.task,
          cwd,
          modelRuntime,
          fallbackModel,
          signal,
        });
        return text(result);
      },
    }),

    defineTool({
      name: "define_subagent",
      label: "Define a subagent",
      description:
        "Author a subagent definition: a name, a system prompt, and optionally a " +
        "restricted tool list and model, that run_subagent can then delegate tasks to. " +
        "It is an instruction, not code, so — unlike define_extension — it takes effect " +
        "immediately: no review step, usable by run_subagent in this same conversation " +
        "right after this call. Re-defining an existing name overwrites it. " +
        reach,
      parameters: Type.Object({
        name: Type.String({
          description:
            "Subagent name, lowercase letters/digits/dashes, e.g. scout. Both the " +
            "filename and the name run_subagent's `agent` parameter takes.",
        }),
        description: Type.String({
          description:
            "One line on what this subagent does. Shown to run_subagent's caller.",
        }),
        system_prompt: Type.String({
          description:
            "The subagent's system prompt: who it is and how it should approach a task.",
        }),
        tools: Type.Optional(Type.Array(Type.String(), {
          description:
            "Restrict the subagent to these tool names (e.g. read, grep, find, ls, " +
            "bash, edit, write). Omit to give it pi's default base tools.",
        })),
        model: Type.Optional(Type.String({
          description:
            'A model id, or "provider/id". Omit to inherit the parent conversation\'s model.',
        })),
      }),
      async execute(_id, p) {
        assertAgentName(p.name);
        await ensureAgentDirs(scope);
        await Deno.writeTextFile(
          agentPath(scope, p.name),
          agentFile({
            description: p.description,
            tools: p.tools,
            model: p.model,
            systemPrompt: p.system_prompt,
          }),
        );
        return text(`Defined subagent ${p.name}. ${reach}`);
      },
    }),
  ];
}
