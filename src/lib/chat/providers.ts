// Deno-side model-provider management. Runs in the desktop process only.
//
// "Provider agnostic like pi": pique exposes pi's own two connection mechanisms
// over win.bind, so any provider pi supports can be connected from the UI —
//   • API keys for built-in cloud providers (anthropic, openai, google, …),
//     persisted via runtime.login() → ~/.pi/agent/auth.json.
//   • Custom OpenAI-compatible endpoints (LM Studio, Ollama, vLLM, …), written
//     as ~/.pi/agent/models.json provider entries — the SAME shape the user's
//     LM Studio already uses.
// Both files are shared with the `pi` CLI by design (only extensions are kept
// separate in ~/.pique; see settings/file.ts). Mutations run against the one
// shared ModelRuntime (see chat/agent.ts) so they take effect without a restart.
//
// The frontend half is the provider* win.bind handlers in src/desktop.ts; keep
// arg/return shapes in sync by hand (separate module graphs, as with chat/ext).

import { ensureRuntime } from "./agent.ts";
import { home } from "../home.ts";

// JSON-safe projection of a pi Provider for the Settings UI.
export type ProviderInfo = {
  id: string;
  name: string;
  configured: boolean; // has usable auth (stored key, env var, or keyless local)
  canApiKey: boolean; // supports interactive API-key login
  isCustom: boolean; // defined by a models.json entry pique can remove
};

// One model the runtime can serve, addressed the way a stored `provider/model-id` ref
// is. Distinct from chat/agent.ts's ModelInfo, which also marks which one a LIVE chat
// session is on: the automaton editor has no session, only a definition to write into.
export type ModelOption = { provider: string; id: string; name: string };

// A user-defined OpenAI-compatible endpoint, as entered in the Settings form.
export type CustomProviderInput = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
};

// The parsed ~/.pi/agent/models.json. Only `providers` is touched; any other
// keys the user (or pi) put there are preserved on write.
type ModelsJson = { providers?: Record<string, unknown>; [k: string]: unknown };

// Provider ids key a models.json object and are used in model refs, so keep them
// to a conservative, path-safe set (matches how pi ids look: "lmstudio", "xai").
const PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// --- Pure helpers (unit-tested; no runtime/filesystem) -----------------------

// deno-lint-ignore no-explicit-any
export function toProviderInfo(
  provider: any,
  configured: boolean,
  isCustom: boolean,
): ProviderInfo {
  const name = typeof provider?.name === "string" && provider.name
    ? provider.name
    : String(provider?.id);
  return {
    id: String(provider?.id),
    name,
    configured,
    canApiKey: Boolean(provider?.auth?.apiKey?.login),
    isCustom,
  };
}

// The models.json provider entry for a custom endpoint. `openai-completions` is
// the broadly-compatible API (the same one LM Studio uses here); the per-model
// fields are conservative defaults the user can refine by editing the file.
export function buildCustomEntry(
  input: CustomProviderInput,
): Record<string, unknown> {
  const apiKey = input.apiKey?.trim();
  return {
    baseUrl: input.baseUrl.trim(),
    api: "openai-completions",
    ...(apiKey ? { apiKey } : {}),
    models: input.models.map((id) => ({
      id,
      reasoning: false,
      contextWindow: 128000,
      input: ["text"],
    })),
  };
}

// Immutably add/replace one provider entry, preserving other keys in the file.
export function upsertCustomProvider(
  config: unknown,
  input: CustomProviderInput,
): ModelsJson {
  const base: ModelsJson =
    config && typeof config === "object" && !Array.isArray(config)
      ? { ...(config as ModelsJson) }
      : {};
  return {
    ...base,
    providers: {
      ...(base.providers ?? {}),
      [input.id]: buildCustomEntry(input),
    },
  };
}

// Immutably drop one provider entry, preserving other keys in the file.
export function removeProviderFromConfig(
  config: unknown,
  id: string,
): ModelsJson {
  const base: ModelsJson =
    config && typeof config === "object" && !Array.isArray(config)
      ? { ...(config as ModelsJson) }
      : {};
  const providers = { ...(base.providers ?? {}) };
  delete providers[id];
  return { ...base, providers };
}

// The provider ids that live in models.json — the ones pique may remove. A
// missing/blank/non-object config yields none.
export function customProviderIds(config: unknown): Set<string> {
  const providers = (config as ModelsJson | null)?.providers;
  return new Set(
    providers && typeof providers === "object" ? Object.keys(providers) : [],
  );
}

export function validateCustomInput(input: CustomProviderInput): void {
  if (!PROVIDER_ID_RE.test(input.id)) {
    throw new Error(`invalid provider id: ${input.id}`);
  }
  if (input.baseUrl.trim() === "") throw new Error("base URL is required");
  if (input.models.length === 0) {
    throw new Error("at least one model id is required");
  }
}

// The pi login flow drives an interaction to collect credentials. For an API
// key it prompts once (secret/text); feed the UI-provided key to those prompts
// and reject anything else so a multi-field flow surfaces as an error, not a
// silently-wrong credential.
export function apiKeyInteraction(apiKey: string) {
  return {
    prompt: (p: { type: string }): Promise<string> =>
      p.type === "secret" || p.type === "text"
        ? Promise.resolve(apiKey)
        : Promise.reject(
          new Error(`unsupported auth prompt for API-key login: ${p.type}`),
        ),
    notify: () => {},
  };
}

// --- Runtime + models.json plumbing ------------------------------------------

function piModelsPath(): string {
  return `${home()}/.pi/agent/models.json`;
}

// Missing or corrupt file → {} so callers add the first entry cleanly (mirrors
// settings/file.ts readJson).
async function readModelsJson(): Promise<ModelsJson> {
  try {
    return JSON.parse(await Deno.readTextFile(piModelsPath()));
  } catch {
    return {};
  }
}

async function writeModelsJson(data: ModelsJson): Promise<void> {
  const path = piModelsPath();
  // A custom provider's entry carries its apiKey, so keep the file to the owner —
  // the default mode is 0644, readable by every other user on the host.
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
    recursive: true,
    mode: 0o700,
  });
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const runtime = await ensureRuntime();
  const custom = customProviderIds(await readModelsJson());
  return runtime.getProviders().map((p: { id: string }) =>
    toProviderInfo(
      p,
      runtime.getProviderAuthStatus(p.id).configured,
      custom.has(p.id),
    )
  );
}

// Every model the connected providers offer. Session-independent, which is what makes
// it usable from a picker that is choosing a model for a run that does not exist yet.
export async function listModels(): Promise<ModelOption[]> {
  const runtime = await ensureRuntime();
  // deno-lint-ignore no-explicit-any
  const available: any[] = await runtime.getAvailable();
  return available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
  }));
}

// Persist an API key for a built-in provider via pi's login flow (→ auth.json).
export async function connectProvider(
  id: string,
  apiKey: string,
): Promise<void> {
  if (apiKey.trim() === "") throw new Error("API key is required");
  const runtime = await ensureRuntime();
  await runtime.login(id, "api_key", apiKeyInteraction(apiKey.trim()));
}

export async function disconnectProvider(id: string): Promise<void> {
  const runtime = await ensureRuntime();
  await runtime.logout(id);
}

// Write the endpoint to models.json, then reload so the live runtime serves it.
export async function addCustomProvider(
  input: CustomProviderInput,
): Promise<void> {
  validateCustomInput(input);
  await writeModelsJson(upsertCustomProvider(await readModelsJson(), input));
  await (await ensureRuntime()).reloadConfig();
}

export async function removeCustomProvider(id: string): Promise<void> {
  const config = await readModelsJson();
  if (!customProviderIds(config).has(id)) {
    throw new Error(`not a custom provider: ${id}`);
  }
  await writeModelsJson(removeProviderFromConfig(config, id));
  await (await ensureRuntime()).reloadConfig();
}
