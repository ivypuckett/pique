// The agent half of tool definition: one pi tool that lets an agent author another
// tool. Written source lands in the quarantine dir ONLY (paths.ts) — it cannot
// execute until a human approves it in Settings → Tools, which moves it into the
// auto-discovered extensions dir. Passed to createAgentSession as customTools
// (see chat/agent.ts). Runs Deno-side only.
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { assertToolName, ensureToolDirs, pendingPath } from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// The rationale is recorded as a header comment rather than a sidecar file, so the
// reviewer reads intent and code together — the source is the whole artifact.
function withHeader(source: string, rationale: string): string {
  return `// Defined by an agent. Rationale: ${rationale.replace(/\r?\n/g, " ")}\n${source}`;
}

// Bound to the scope its chat agent runs in: a tool an agent defines is quarantined
// in that scope, so approving it in a workspace grants it to that workspace alone.
// An agent in root defines tools every workspace will inherit — the description says
// so, since the agent should know how far its tool will reach.
export function toolAuthoringTools(scope: ScopeId): ToolDefinition[] {
  const reach = scope === ROOT
    ? "This agent runs in the ROOT workspace, so an approved tool is inherited by every workspace."
    : "This agent runs in a single workspace, so an approved tool is available only there.";
  return [
    defineTool({
      name: "define_tool",
      label: "Define a tool",
      description:
        "Author a new tool for this agent, as a pi extension module. `source` must be TypeScript " +
        "with a default-exported function taking pi: ExtensionAPI, which calls pi.registerTool(). " +
        "The tool does NOT become callable immediately: it is written to a quarantine directory " +
        "and only runs after the user reviews and approves it in Settings → Tools, and then only " +
        "in chat sessions started afterwards. Say so when reporting back. " + reach,
      parameters: Type.Object({
        name: Type.String({
          description: "Tool name, lowercase letters/digits/underscores, e.g. lookup_weather.",
        }),
        rationale: Type.String({
          description: "Why this tool is needed. Shown to the user when they review it.",
        }),
        source: Type.String({ description: "The full TypeScript module source." }),
      }),
      async execute(_id, p) {
        assertToolName(p.name);
        await ensureToolDirs(scope);
        await Deno.writeTextFile(pendingPath(scope, p.name), withHeader(p.source, p.rationale));
        return {
          content: [{
            type: "text",
            text: `Wrote ${p.name} to the pending directory. It is not callable yet — the user ` +
              `must approve it in Settings → Tools, and it loads in chat sessions started after that.`,
          }],
          details: null,
        };
      },
    }),
  ];
}
