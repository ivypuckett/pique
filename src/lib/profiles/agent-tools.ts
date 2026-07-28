// The agent half of profile authoring: one pi tool that lets an agent write a profile
// for a later session to run under. The file lands in the quarantine dir ONLY
// (paths.ts) — it cannot be selected in a Chat module until a human approves it in
// Settings → Profiles, which moves it into the live dir. Passed to createAgentSession
// as customTools (see chat/agent.ts). Runs Deno-side only.
import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { assertProfileName, ensureProfileDirs, pendingProfilePath } from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

// Frontmatter is emitted by hand rather than with a YAML writer: the schema is three
// keys wide, and JSON's encoding of a string or a string list is valid YAML flow syntax.
// That is also what contains the text — a description holding `---` or a newline stays
// inside its quoted scalar instead of ending the frontmatter block.
function profileFile(p: {
  description: string;
  rationale: string;
  tools?: string[];
  prompt: string;
}): string {
  const lines = [
    `description: ${JSON.stringify(p.description)}`,
    // Recorded for the human reviewing this profile. It is deliberately NOT part of the
    // body, because the body becomes system-prompt text for whichever model runs under it.
    `rationale: ${JSON.stringify(p.rationale)}`,
  ];
  // Omitted and empty mean different things (no allowlist vs no tools), so an absent
  // `tools` must stay absent rather than being written as [].
  if (p.tools) lines.push(`tools: ${JSON.stringify(p.tools)}`);
  return `---\n${lines.join("\n")}\n---\n\n${p.prompt.trim()}\n`;
}

// Bound to the scope its chat agent runs in: a profile an agent defines is quarantined
// in that scope, so approving it in a workspace grants it to that workspace alone. An
// agent in root defines profiles every workspace will see — the description says so,
// since the agent should know how far its profile will reach.
export function profileAuthoringTools(scope: ScopeId): ToolDefinition[] {
  const reach = scope === ROOT
    ? "This agent runs in the ROOT workspace, so an approved profile is available in every workspace."
    : "This agent runs in a single workspace, so an approved profile is available only there.";
  return [
    defineTool({
      name: "define_profile",
      label: "Define a profile",
      description:
        "Author a profile: a named base prompt plus an allowlist of tools, which the user can " +
        "then select for a chat session. The profile does NOT take effect immediately: it is " +
        "written to a quarantine directory and only becomes selectable after the user reviews " +
        "and approves it in Settings → Profiles. Say so when reporting back. `tools` can only " +
        "NARROW what a session already has — listing a tool that does not exist has no effect, " +
        "and a profile can never grant a capability the workspace lacks. Omit `tools` to leave " +
        "the tool set unrestricted; pass an empty list for a profile with no tools at all. " +
        reach,
      parameters: Type.Object({
        name: Type.String({
          description: "Profile name, lowercase letters/digits/dashes, e.g. code-reviewer. " +
            "It is both the filename and the label the user picks from.",
        }),
        description: Type.String({
          description: "One line on what this profile is for. Shown next to the name.",
        }),
        rationale: Type.String({
          description: "Why this profile is needed. Shown to the user when they review it, and " +
            "never included in the prompt itself.",
        }),
        prompt: Type.String({
          description: "The profile's prompt text. It is APPENDED to the base system prompt, " +
            "so write what should be added, not a whole agent definition.",
        }),
        tools: Type.Optional(Type.Array(Type.String(), {
          description: "Allowlist of tool names. Omit for no restriction.",
        })),
      }),
      async execute(_id, p) {
        assertProfileName(p.name);
        await ensureProfileDirs(scope);
        await Deno.writeTextFile(pendingProfilePath(scope, p.name), profileFile(p));
        return {
          content: [{
            type: "text",
            text: `Wrote the profile ${p.name} to the pending directory. It is not selectable ` +
              `yet — the user must approve it in Settings → Profiles.`,
          }],
          details: null,
        };
      },
    }),
  ];
}
