import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  apiKeyInteraction,
  buildCustomEntry,
  customProviderIds,
  removeProviderFromConfig,
  toProviderInfo,
  upsertCustomProvider,
  validateCustomInput,
} from "./providers.ts";

Deno.test("toProviderInfo projects id/name/flags", () => {
  const p = {
    id: "anthropic",
    name: "Anthropic",
    auth: { apiKey: { login: () => {} } },
  };
  assertEquals(toProviderInfo(p, { configured: true, source: "stored" }, false), {
    id: "anthropic",
    name: "Anthropic",
    configured: true,
    canApiKey: true,
    isCustom: false,
    source: "stored",
    sourceLabel: undefined,
  });
});

Deno.test("toProviderInfo falls back to id when name is missing, and canApiKey false without login", () => {
  assertEquals(
    toProviderInfo(
      { id: "lmstudio", auth: { apiKey: {} } },
      { configured: true, source: "models_json_key" },
      true,
    ),
    {
      id: "lmstudio",
      name: "lmstudio",
      configured: true,
      canApiKey: false,
      isCustom: true,
      source: "models_json_key",
      sourceLabel: undefined,
    },
  );
});

// Bedrock reads as connected from an ambient AWS_PROFILE with nothing stored, and
// logout cannot unset that — the UI needs the source to say so rather than offering a
// Disconnect that does nothing visible.
Deno.test("toProviderInfo carries the environment source and its variable name", () => {
  const info = toProviderInfo(
    { id: "amazon-bedrock", name: "Amazon Bedrock", auth: { apiKey: { login: () => {} } } },
    { configured: true, source: "environment", label: "AWS_PROFILE" },
    false,
  );
  assertEquals(info.source, "environment");
  assertEquals(info.sourceLabel, "AWS_PROFILE");
});

Deno.test("buildCustomEntry uses openai-completions and maps model ids", () => {
  assertEquals(
    buildCustomEntry({ id: "x", baseUrl: " http://h/v1 ", models: ["a", "b"] }),
    {
      baseUrl: "http://h/v1",
      api: "openai-completions",
      apiKey: "not-required",
      models: [
        { id: "a", reasoning: false, contextWindow: 128000, input: ["text"] },
        { id: "b", reasoning: false, contextWindow: 128000, input: ["text"] },
      ],
    },
  );
});

Deno.test("buildCustomEntry trims the apiKey, and stands one in when blank", () => {
  assertEquals(
    buildCustomEntry({ id: "x", baseUrl: "u", apiKey: " k ", models: ["a"] })
      .apiKey,
    "k",
  );
  // Blank or absent still writes a key: pi drops a provider with none from
  // getAvailable(), so a keyless local endpoint would offer no models at all.
  for (const apiKey of ["  ", undefined]) {
    assertEquals(
      buildCustomEntry({ id: "x", baseUrl: "u", apiKey, models: ["a"] }).apiKey,
      "not-required",
    );
  }
});

Deno.test("upsertCustomProvider preserves other keys and providers", () => {
  const config = { version: 2, providers: { lmstudio: { baseUrl: "keep" } } };
  const out = upsertCustomProvider(config, {
    id: "ollama",
    baseUrl: "http://o/v1",
    models: ["m"],
  });
  assertEquals(out.version, 2);
  assertEquals((out.providers as Record<string, unknown>).lmstudio, {
    baseUrl: "keep",
  });
  assertEquals(
    (out.providers as Record<string, { baseUrl: string }>).ollama.baseUrl,
    "http://o/v1",
  );
});

Deno.test("upsertCustomProvider seeds providers on an empty/absent config", () => {
  const out = upsertCustomProvider(null, {
    id: "x",
    baseUrl: "u",
    models: ["m"],
  });
  assertEquals(Object.keys(out.providers ?? {}), ["x"]);
});

Deno.test("removeProviderFromConfig drops one entry, keeps the rest", () => {
  const config = { providers: { a: {}, b: {} }, extra: 1 };
  const out = removeProviderFromConfig(config, "a");
  assertEquals(Object.keys(out.providers ?? {}), ["b"]);
  assertEquals(out.extra, 1);
});

Deno.test("customProviderIds reads the providers map, empty when absent/malformed", () => {
  assertEquals([...customProviderIds({ providers: { a: {}, b: {} } })], [
    "a",
    "b",
  ]);
  assertEquals(customProviderIds(null).size, 0);
  assertEquals(customProviderIds({}).size, 0);
  assertEquals(customProviderIds("nope").size, 0);
});

Deno.test("validateCustomInput rejects bad id, blank url, and no models", () => {
  assertThrows(
    () => validateCustomInput({ id: "has space", baseUrl: "u", models: ["m"] }),
    Error,
    "invalid provider id",
  );
  assertThrows(
    () => validateCustomInput({ id: "ok", baseUrl: "  ", models: ["m"] }),
    Error,
    "base URL",
  );
  assertThrows(
    () => validateCustomInput({ id: "ok", baseUrl: "u", models: [] }),
    Error,
    "at least one model",
  );
  validateCustomInput({ id: "lm-studio_2", baseUrl: "u", models: ["m"] }); // does not throw
});

Deno.test("apiKeyInteraction returns the key for secret/text prompts", async () => {
  const it = apiKeyInteraction("sk-123");
  assertEquals(await it.prompt({ type: "secret" }), "sk-123");
  assertEquals(await it.prompt({ type: "text" }), "sk-123");
  await assertRejects(
    () => it.prompt({ type: "select" }),
    Error,
    "unsupported auth prompt",
  );
});

Deno.test("apiKeyInteraction answers a select with the chosen method", async () => {
  // Bedrock's real flow: select the method, then the follow-up prompt takes the value.
  const it = apiKeyInteraction("work-sso", "aws-profile");
  const options = [
    { id: "bearer-token" },
    { id: "aws-profile" },
    { id: "credential-chain" },
  ];
  assertEquals(await it.prompt({ type: "select", options }), "aws-profile");
  assertEquals(await it.prompt({ type: "text" }), "work-sso");
});

Deno.test("apiKeyInteraction rejects a method the prompt does not offer", async () => {
  const it = apiKeyInteraction("v", "aws-profile");
  await assertRejects(
    () => it.prompt({ type: "select", options: [{ id: "bearer-token" }] }),
    Error,
    'auth method "aws-profile" is not offered',
  );
  // A select with no options at all is the same failure, not a silent pass.
  await assertRejects(
    () => it.prompt({ type: "select" }),
    Error,
    "is not offered",
  );
});
