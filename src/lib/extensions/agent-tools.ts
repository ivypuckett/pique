// The agent half of extension authoring: one pi tool that lets an agent write another
// extension. Written source lands in the quarantine dir ONLY (paths.ts) — it cannot
// execute until a human reviews and enables it in the Library module, which moves it
// into the auto-discovered extensions dir. Passed to createAgentSession as customTools
// (see chat/agent.ts). Runs Deno-side only.
import { Type } from "typebox";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  assertExtensionName,
  ensureExtensionDirs,
  pendingPath,
} from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// The rationale is recorded as a header comment rather than a sidecar file, so the
// reviewer reads intent and code together — the source is the whole artifact.
function withHeader(source: string, rationale: string): string {
  return `// Defined by an agent. Rationale: ${
    rationale.replace(/\r?\n/g, " ")
  }\n${source}`;
}

// Bound to the scope its chat agent runs in: an extension an agent writes is
// quarantined in that scope, so enabling it in a workspace grants it to that workspace
// alone. An agent in root writes extensions every workspace will inherit — the
// description says so, since the agent should know how far its code will reach.
export function extensionAuthoringTools(scope: ScopeId): ToolDefinition[] {
  const reach = scope === ROOT
    ? "This agent runs in the ROOT workspace, so an enabled extension is inherited by every workspace."
    : "This agent runs in a single workspace, so an enabled extension is available only there.";
  return [
    defineTool({
      name: "define_extension",
      label: "Define an extension",
      description:
        "Author a new extension for this agent, as a pi extension module. `source` must be " +
        "TypeScript with a default-exported function taking pi: ExtensionAPI, which calls " +
        "pi.registerTool() one or more times. The tools it registers do NOT become callable " +
        "immediately: the module is written to a quarantine directory and only runs after the " +
        "user reviews and enables it in the Library module, and then only in chat sessions " +
        "started afterwards. Say so when reporting back. " + reach,
      parameters: Type.Object({
        name: Type.String({
          description:
            "Extension name, lowercase letters/digits/underscores, e.g. lookup_weather.",
        }),
        rationale: Type.String({
          description:
            "Why this extension is needed. Shown to the user when they review it.",
        }),
        source: Type.String({
          description: "The full TypeScript module source.",
        }),
      }),
      async execute(_id, p) {
        assertExtensionName(p.name);
        await ensureExtensionDirs(scope);
        await Deno.writeTextFile(
          pendingPath(scope, p.name),
          withHeader(p.source, p.rationale),
        );
        return {
          content: [{
            type: "text",
            text:
              `Wrote ${p.name} to the pending directory. It is not active yet — the user ` +
              `must enable it in the Library module, and it loads in chat sessions started ` +
              `after that.`,
          }],
          details: null,
        };
      },
    }),
  ];
}
