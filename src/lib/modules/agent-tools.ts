// The agent half of module authoring: one pi tool that lets an agent write a panel for
// the user to look at. Everything it writes lands in the quarantine dir only, and a
// human consenting in the Library module is what moves it into use — which for a module
// means consenting to the capabilities it asks for, not only to its code.
//
// That is a property of THIS PATH, not of the system: the gate is advisory
// (docs/modules.md), because the same agent holds `write` and `bash` and can put both
// files straight into `extensions/` without coming through here. Do not build anything
// on the stronger reading. What holds regardless is the broker: a module cannot exceed
// the manifest it declared, however that manifest arrived.
//
// Passed to createAgentSession as customTools (see chat/agent.ts). Runs Deno-side only.
import { Type } from "typebox";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { ensureExtensionDirs, pendingDir } from "../extensions/paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";
import { parseDefinition } from "./definition.ts";

// A module is ONE document: its frame's origin is opaque, so it can fetch nothing, and
// `'self'` matches nothing either — a `<script src>` simply never loads. The frame
// cannot report that (under the CSP a blocked request still looks like success to its
// own JavaScript), so the failure would be silent and remote from its cause. Refuse it
// here, where there is someone to tell.
function externalReference(html: string): string | undefined {
  if (/<script[^>]+\bsrc\s*=/i.test(html)) return "<script src=…>";
  if (/<link[^>]+\bhref\s*=/i.test(html)) return "<link href=…>";
  return undefined;
}

// Bound to the scope its chat agent runs in: a module an agent writes is quarantined in
// that scope, so consenting to it in a workspace grants it to that workspace alone. An
// agent in root writes a module every workspace will inherit — the description says so,
// since the agent should know how far its panel will reach.
export function moduleAuthoringTools(scope: ScopeId): ToolDefinition[] {
  const reach = scope === ROOT
    ? "This agent runs in the ROOT workspace, so a consented module appears in every workspace."
    : "This agent runs in a single workspace, so a consented module appears only there.";
  return [
    defineTool({
      name: "define_module",
      label: "Define a module",
      description:
        "Author a panel for the user: a module that appears as its own row in the right " +
        "pane. `html` is ONE self-contained document — put its script and style INLINE, " +
        "because the frame it runs in cannot load its own files or reach the network at " +
        "all. It talks to pique over a MessagePort posted to it on load; see " +
        "docs/modules.md for the protocol and the methods each capability unlocks. The " +
        "module does NOT appear immediately: it is written to a quarantine directory and " +
        "only runs after the user reviews the capabilities it asks for and consents in " +
        "the Library module. Say so when reporting back. " + reach,
      parameters: Type.Object({
        name: Type.String({
          description:
            "Module name, lowercase letters/digits/underscores, e.g. release_notes. " +
            "Becomes its id; cannot be the name of a built-in module.",
        }),
        label: Type.String({
          description: "Title for its rail row and tab, e.g. Release Notes.",
        }),
        rationale: Type.String({
          description:
            "Why this panel is worth having. Shown to the user when they review it.",
        }),
        html: Type.String({
          description:
            "The complete HTML document, script and style inlined. No external files.",
        }),
        duplicable: Type.Optional(Type.Boolean({
          description: "May a view hold more than one tab of it? Default false.",
        })),
        capabilities: Type.Optional(Type.Object({
          kanban: Type.Optional(Type.Boolean({
            description: "Read this scope's kanban board.",
          })),
          storage: Type.Optional(Type.Boolean({
            description: "Keep its own saved JSON, private to it and this scope.",
          })),
          fs: Type.Optional(Type.Object({
            read: Type.Optional(Type.Array(Type.String(), {
              description: "Absolute directory roots it may read under.",
            })),
            write: Type.Optional(Type.Array(Type.String(), {
              description: "Absolute directory roots it may write under.",
            })),
          })),
        }, {
          description:
            "What the module needs. Ask for the least that works: the user reads this " +
            "list and decides. Omit for a panel that only draws.",
        })),
      }),
      async execute(_id, p) {
        const external = externalReference(p.html);
        if (external) {
          throw new Error(
            `${external} will not load: a module is one document with its script and ` +
              `style inline. The frame's origin is opaque, so it cannot fetch its own ` +
              `files, and it cannot tell you the request was blocked.`,
          );
        }

        // Validated through the SAME parser the Library and the broker use, before
        // anything is written. An agent gets told what is wrong now, rather than the
        // user meeting a row that will not parse later.
        const definition = {
          label: p.label,
          duplicable: p.duplicable,
          capabilities: p.capabilities ?? {},
        };
        const parsed = parseDefinition(p.name, JSON.stringify(definition));
        if (!parsed.ok) throw new Error(parsed.error);

        await ensureExtensionDirs(scope);
        const dir = pendingDir(scope);
        // The rationale rides in the definition rather than a sidecar: the consent
        // screen reads this file, and intent belongs where the grants are read.
        await Deno.writeTextFile(
          `${dir}/${p.name}.module.json`,
          JSON.stringify({ ...definition, rationale: p.rationale }, null, 2),
        );
        await Deno.writeTextFile(`${dir}/${p.name}.ui.html`, p.html);

        const asked = Object.keys(p.capabilities ?? {});
        return {
          content: [{
            type: "text",
            text: `Wrote ${p.name} to the pending directory. It is not visible yet — ` +
              `the user must consent to it in the Library module` +
              (asked.length
                ? `, where they will see it asks for: ${asked.join(", ")}.`
                : `. It asks for no capabilities.`),
          }],
          details: null,
        };
      },
    }),
  ];
}
