import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  authStatusFallback,
  buildCustomEntry,
  customProviderIds,
  LoginFlow,
  type LoginInteraction,
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
  assertEquals(
    toProviderInfo(p, { configured: true, source: "stored" }, false),
    {
      id: "anthropic",
      name: "Anthropic",
      configured: true,
      canApiKey: true,
      isCustom: false,
      source: "stored",
      sourceLabel: undefined,
    },
  );
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
    {
      id: "amazon-bedrock",
      name: "Amazon Bedrock",
      auth: { apiKey: { login: () => {} } },
    },
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

// The shape of pi's Amazon Bedrock login: a select between methods, a note, then the
// follow-up prompt the chosen method needs.
async function bedrockLogin(i: LoginInteraction) {
  const method = await i.prompt({
    type: "select",
    message: "Select Amazon Bedrock authentication method:",
    options: [
      { id: "bearer-token", label: "Bearer token" },
      { id: "aws-profile", label: "AWS profile" },
    ],
  });
  if (method === "bearer-token") {
    return { key: await i.prompt({ type: "secret", message: "Enter token" }) };
  }
  i.notify({
    type: "info",
    message: "Bedrock supports AWS profiles.",
    links: [{ url: "https://docs.aws.amazon.com/" }],
  });
  return {
    profile: await i.prompt({
      type: "text",
      message: "Enter AWS profile name",
    }),
  };
}

Deno.test("LoginFlow walks a login one prompt at a time, carrying its notes", async () => {
  let stored: unknown;
  const flow = new LoginFlow(async (i) => {
    stored = await bedrockLogin(i);
  });
  const first = await flow.next();
  assertEquals(first.done, false);
  if (first.done) return;
  assertEquals(first.prompt.type, "select");
  assertEquals(first.prompt.options?.map((o) => o.id), [
    "bearer-token",
    "aws-profile",
  ]);
  assertEquals(first.notes, []);

  const second = await flow.answer("aws-profile");
  assertEquals(second.done, false);
  if (second.done) return;
  assertEquals(second.prompt, {
    type: "text",
    message: "Enter AWS profile name",
    placeholder: undefined,
    options: undefined,
  });
  assertEquals(second.notes, [{
    message: "Bedrock supports AWS profiles.",
    links: [{ url: "https://docs.aws.amazon.com/" }],
  }]);

  assertEquals(await flow.answer("work-sso"), { done: true });
  assertEquals(stored, { profile: "work-sso" });
});

Deno.test("LoginFlow finishes at once for a login with nothing to ask", async () => {
  const flow = new LoginFlow(() => Promise.resolve());
  assertEquals(await flow.next(), { done: true });
});

Deno.test("LoginFlow rejects the step a failed login was on", async () => {
  const flow = new LoginFlow(async (i) => {
    await i.prompt({ type: "secret", message: "API key" });
    throw new Error("invalid key");
  });
  await flow.next();
  await assertRejects(() => flow.answer("nope"), Error, "invalid key");
});

Deno.test("LoginFlow cancel ends the login without an unhandled rejection", async () => {
  let reason = "";
  const flow = new LoginFlow(async (i) => {
    try {
      await i.prompt({ type: "secret", message: "API key" });
    } catch (e) {
      reason = (e as Error).message;
      throw e;
    }
  });
  await flow.next();
  flow.cancel();
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(reason, "login cancelled");
  assertThrows(() => flow.answer("late"), Error, "not waiting");
});

// A snapshot emptied by one throwing provider makes every provider read as
// unconfigured; the fallback re-establishes what the credential store and a live
// check can say on their own.
Deno.test("authStatusFallback prefers a stored credential, then a live check", () => {
  assertEquals(authStatusFallback(true, undefined), {
    configured: true,
    source: "stored",
  });
  assertEquals(authStatusFallback(false, { source: "AWS_PROFILE" }), {
    configured: true,
    source: "environment",
    label: "AWS_PROFILE",
  });
  assertEquals(authStatusFallback(false, undefined), { configured: false });
});
