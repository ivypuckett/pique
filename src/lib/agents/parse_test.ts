import { assertEquals } from "@std/assert";
import { agentFile, parseAgentDef } from "./parse.ts";

Deno.test("frontmatter supplies description, tools, and model", () => {
  const def = parseAgentDef(
    "scout",
    "---\ndescription: Fast recon\ntools: read, grep, find\nmodel: claude-haiku-4-5\n---\nYou are a scout.\n",
  );
  assertEquals(def.name, "scout");
  assertEquals(def.description, "Fast recon");
  assertEquals(def.tools, ["read", "grep", "find"]);
  assertEquals(def.model, "claude-haiku-4-5");
  assertEquals(def.systemPrompt, "You are a scout.");
  assertEquals(def.error, undefined);
});

Deno.test("tools and model are optional", () => {
  const def = parseAgentDef(
    "worker",
    "---\ndescription: General purpose\n---\nBody text\n",
  );
  assertEquals(def.tools, undefined);
  assertEquals(def.model, undefined);
});

Deno.test("a definition with no frontmatter has an empty description, not an error", () => {
  const def = parseAgentDef("bare", "Just a system prompt\n");
  assertEquals(def.description, "");
  assertEquals(def.systemPrompt, "Just a system prompt");
  assertEquals(def.error, undefined);
});

Deno.test("malformed frontmatter is reported and the file is still readable", () => {
  const def = parseAgentDef("bad", "---\ndescription: [unclosed\n---\nbody");
  assertEquals(def.error?.startsWith("frontmatter:"), true);
  assertEquals(def.systemPrompt.includes("body"), true);
});

Deno.test("a blank tools value is treated as absent", () => {
  const def = parseAgentDef(
    "x",
    '---\ndescription: d\ntools: " , ,"\n---\nbody',
  );
  assertEquals(def.tools, undefined);
});

Deno.test("agentFile round-trips through parseAgentDef", () => {
  const text = agentFile({
    description: "Fast recon",
    tools: ["read", "grep"],
    model: "claude-haiku-4-5",
    systemPrompt: "You are a scout.",
  });
  const def = parseAgentDef("scout", text);
  assertEquals(def.description, "Fast recon");
  assertEquals(def.tools, ["read", "grep"]);
  assertEquals(def.model, "claude-haiku-4-5");
  assertEquals(def.systemPrompt, "You are a scout.");
});

Deno.test("agentFile omits tools and model when absent", () => {
  const text = agentFile({ description: "d", systemPrompt: "p" });
  assertEquals(text.includes("tools"), false);
  assertEquals(text.includes("model"), false);
});
