import { assertEquals } from "@std/assert";
import { availableModels, type ModelSource } from "./available.ts";

function source(
  answers: Record<string, { provider: string; id: string; name?: string }[]>,
  throwing: Record<string, string> = {},
): ModelSource {
  return {
    getProviders: () =>
      [...Object.keys(answers), ...Object.keys(throwing)].map((id) => ({ id })),
    getAvailable: (id) =>
      throwing[id]
        ? Promise.reject(new Error(throwing[id]))
        : Promise.resolve(answers[id] ?? []),
  };
}

Deno.test("availableModels lists every provider's models, defaulting the name to the id", async () => {
  const { models, failed } = await availableModels(source({
    anthropic: [{ provider: "anthropic", id: "claude", name: "Claude" }],
    lmstudio: [{ provider: "lmstudio", id: "gemma" }],
  }));
  assertEquals(models, [
    { provider: "anthropic", id: "claude", name: "Claude" },
    { provider: "lmstudio", id: "gemma", name: "gemma" },
  ]);
  assertEquals(failed.size, 0);
});

// The reason this module exists: expired AWS credentials are an everyday state, and a
// chat aimed at Anthropic must not lose its model because Bedrock cannot answer.
Deno.test("availableModels keeps the other providers when one throws, and names it", async () => {
  const { models, failed } = await availableModels(source(
    { anthropic: [{ provider: "anthropic", id: "claude", name: "Claude" }] },
    {
      "amazon-bedrock": "The security token included in the request is expired",
    },
  ));
  assertEquals(models, [{
    provider: "anthropic",
    id: "claude",
    name: "Claude",
  }]);
  assertEquals(
    failed.get("amazon-bedrock"),
    "The security token included in the request is expired",
  );
});

Deno.test("availableModels reports every failure when they all throw", async () => {
  const { models, failed } = await availableModels(
    source({}, { a: "one", b: "two" }),
  );
  assertEquals(models, []);
  assertEquals([...failed], [["a", "one"], ["b", "two"]]);
});
