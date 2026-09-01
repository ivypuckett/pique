import { assertEquals } from "@std/assert";
import {
  isEnabled,
  type ModelSelection,
  orderModels,
  setEnabled,
  visibleModels,
} from "./models.ts";

const m = (provider: string, id: string, name = id) => ({ provider, id, name });

Deno.test("a provider with no entry has every model enabled", () => {
  assertEquals(isEnabled({}, "anthropic", "opus"), true);
});

Deno.test("an empty list disables every model of that provider", () => {
  assertEquals(isEnabled({ anthropic: [] }, "anthropic", "opus"), false);
});

Deno.test("unchecking one model keeps the rest of the catalog checked", () => {
  const next = setEnabled({}, "anthropic", ["opus", "sonnet", "haiku"], "sonnet", false);
  assertEquals(next, { anthropic: ["opus", "haiku"] });
});

Deno.test("checking a model adds it once, leaving other providers alone", () => {
  const sel: ModelSelection = { anthropic: ["opus"], openai: ["gpt"] };
  assertEquals(setEnabled(sel, "anthropic", ["opus", "sonnet"], "sonnet", true), {
    anthropic: ["opus", "sonnet"],
    openai: ["gpt"],
  });
  assertEquals(setEnabled(sel, "anthropic", ["opus"], "opus", true), sel);
});

Deno.test("pickers list the enabled models, plus the kept ref", () => {
  const models = [m("anthropic", "opus"), m("anthropic", "sonnet"), m("openai", "gpt")];
  const sel: ModelSelection = { anthropic: ["opus"] };
  assertEquals(visibleModels(models, sel).map((x) => x.id), ["opus", "gpt"]);
  assertEquals(
    visibleModels(models, sel, "anthropic/sonnet").map((x) => x.id),
    ["opus", "sonnet", "gpt"],
  );
});

Deno.test("checklist order is enabled first, each half alphabetical by name", () => {
  const models = [m("a", "3", "zeta"), m("a", "1", "beta"), m("a", "2", "alpha")];
  assertEquals(
    orderModels(models, { a: ["3"] }).map((x) => x.name),
    ["zeta", "alpha", "beta"],
  );
});
