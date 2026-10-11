// The agent half of module authoring: one pi tool that lets an agent write a panel for
// the user to look at. It writes straight into pi's extensions dir, so the
// module is in use as soon as the rail refreshes — the chat refreshes it when this tool
// succeeds (chat/store.ts).
//
// The tool is here for what its description carries rather than for what it can do: the
// agent holds `write` and could put both files there itself, but this is where it learns
// what a module is and how it talks to pique.
//
// Passed to createAgentSession as customTools (see chat/agent.ts). Runs Deno-side only.
import { Type } from "typebox";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { ensureExtensionDirs, liveDir } from "../extensions/paths.ts";
import { parseDefinition } from "./definition.ts";

// The module server serves the one document and nothing beside it, so a relative
// `<script src>` or stylesheet 404s — and the agent, which cannot see the frame, would
// never find out. Refuse it here, where there is someone to tell. An absolute URL is the
// author's call: the frame can reach the network.
function relativeReference(html: string): string | undefined {
  const ref = (tag: string, attr: string) =>
    new RegExp(
      `<${tag}[^>]+\\b${attr}\\s*=(?!\\s*["']?(?:[a-z][a-z0-9+.-]*:|//))`,
      "i",
    ).test(html);
  if (ref("script", "src")) return "<script src=…>";
  if (ref("link", "href")) return "<link href=…>";
  return undefined;
}

export function moduleAuthoringTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "define_module",
      label: "Define a module",
      description:
        "Author a panel for the user: a module that appears as its own row in the right " +
        "pane. `html` is ONE document — put its own script and style INLINE, because " +
        "nothing beside it is served; absolute URLs (a CDN) do load. It talks to pique " +
        "over a MessagePort posted to it on load; see docs/modules.md for the protocol " +
        "and its methods (its own saved JSON, and reading and writing files). The module " +
        "is usable as soon as this returns, in every workspace. Calling it again with " +
        "the same name replaces the module.",
      parameters: Type.Object({
        name: Type.String({
          description:
            "Module name, lowercase letters/digits/underscores, e.g. release_notes. " +
            "Becomes its id; cannot be the name of a built-in module.",
        }),
        label: Type.String({
          description: "Title for its rail row and tab, e.g. Release Notes.",
        }),
        html: Type.String({
          description:
            "The complete HTML document, its own script and style inlined.",
        }),
        duplicable: Type.Optional(Type.Boolean({
          description: "May a view hold more than one tab of it? Default false.",
        })),
      }),
      async execute(_id, p) {
        const relative = relativeReference(p.html);
        if (relative) {
          throw new Error(
            `${relative} will not load: a module is one document with its own script ` +
              `and style inline, and nothing beside it is served.`,
          );
        }

        // Validated through the SAME parser the rail uses, before anything is written.
        // An agent gets told what is wrong now, rather than the user meeting a row that
        // will not parse later.
        const definition = { label: p.label, duplicable: p.duplicable };
        const parsed = parseDefinition(p.name, JSON.stringify(definition));
        if (!parsed.ok) throw new Error(parsed.error);

        await ensureExtensionDirs();
        const dir = liveDir();
        // The document first: a definition without one is listed as an error, so the
        // rail never sees a module whose document has not landed yet.
        await Deno.writeTextFile(`${dir}/${p.name}.ui.html`, p.html);
        await Deno.writeTextFile(
          `${dir}/${p.name}.module.json`,
          JSON.stringify(definition, null, 2),
        );

        return {
          content: [{
            type: "text",
            text: `Wrote ${p.name}. It is in the right pane's rail as ${p.label}.`,
          }],
          details: null,
        };
      },
    }),
  ];
}
