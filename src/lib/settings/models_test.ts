import { assertEquals } from "@std/assert";
import {
  isEnabled,
  isEnabledByDefault,
  type ModelSelection,
  orderModels,
  setEnabled,
  visibleModels,
} from "./models.ts";

const m = (provider: string, id: string, name = id) => ({ provider, id, name });

Deno.test("a provider with no entry has every model enabled", () => {
  assertEquals(isEnabled({}, "anthropic", "opus"), true);
});

Deno.test("Bedrock starts with only its global inference profiles enabled", () => {
  // The rest of the catalog is unchecked rather than hidden: still listed in Settings,
  // one click from being usable.
  assertEquals(
    isEnabled({}, "amazon-bedrock", "global.anthropic.claude-opus-5"),
    true,
  );
  assertEquals(
    isEnabled({}, "amazon-bedrock", "us.anthropic.claude-opus-5"),
    false,
  );
  assertEquals(
    isEnabled({}, "amazon-bedrock", "meta.llama3-1-8b-instruct-v1:0"),
    false,
  );
  // Every other provider still starts with its whole catalog on.
  assertEquals(isEnabledByDefault("anthropic", "anything"), true);
});

Deno.test("a stored Bedrock list overrides the global-only default", () => {
  const sel: ModelSelection = { "amazon-bedrock": ["us.meta.llama4-scout"] };
  assertEquals(isEnabled(sel, "amazon-bedrock", "us.meta.llama4-scout"), true);
  // Checking something else off the default list does not re-enable the default.
  assertEquals(
    isEnabled(sel, "amazon-bedrock", "global.anthropic.claude-opus-5"),
    false,
  );
});

Deno.test("toggling a Bedrock model materialises the default, not the whole catalog", () => {
  const all = ["global.a", "global.b", "us.c", "meta.d"];
  // Opting one extra model in leaves the defaults on and the other extras off.
  assertEquals(setEnabled({}, "amazon-bedrock", all, "us.c", true), {
    "amazon-bedrock": ["global.a", "global.b", "us.c"],
  });
  // Opting a default out leaves the remaining default on.
  assertEquals(setEnabled({}, "amazon-bedrock", all, "global.a", false), {
    "amazon-bedrock": ["global.b"],
  });
});

Deno.test("an empty list disables every model of that provider", () => {
  assertEquals(isEnabled({ anthropic: [] }, "anthropic", "opus"), false);
});

Deno.test("unchecking one model keeps the rest of the catalog checked", () => {
  const next = setEnabled(
    {},
    "anthropic",
    ["opus", "sonnet", "haiku"],
    "sonnet",
    false,
  );
  assertEquals(next, { anthropic: ["opus", "haiku"] });
});

Deno.test("checking a model adds it once, leaving other providers alone", () => {
  const sel: ModelSelection = { anthropic: ["opus"], openai: ["gpt"] };
  assertEquals(
    setEnabled(sel, "anthropic", ["opus", "sonnet"], "sonnet", true),
    {
      anthropic: ["opus", "sonnet"],
      openai: ["gpt"],
    },
  );
  assertEquals(setEnabled(sel, "anthropic", ["opus"], "opus", true), sel);
});

Deno.test("pickers list the enabled models, plus the kept ref", () => {
  const models = [
    m("anthropic", "opus"),
    m("anthropic", "sonnet"),
    m("openai", "gpt"),
  ];
  const sel: ModelSelection = { anthropic: ["opus"] };
  assertEquals(visibleModels(models, sel).map((x) => x.id), ["opus", "gpt"]);
  assertEquals(
    visibleModels(models, sel, "anthropic/sonnet").map((x) => x.id),
    ["opus", "sonnet", "gpt"],
  );
});

Deno.test("checklist order is enabled first, each half alphabetical by name", () => {
  const models = [
    m("a", "3", "zeta"),
    m("a", "1", "beta"),
    m("a", "2", "alpha"),
  ];
  assertEquals(
    orderModels(models, { a: ["3"] }).map((x) => x.name),
    ["zeta", "alpha", "beta"],
  );
});
