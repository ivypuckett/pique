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

import { dirname } from "@std/path";
import { ensureRuntime } from "./agent.ts";
import { home } from "../home.ts";
import {
  BEDROCK,
  detectAwsProfiles,
  filterBedrockModels,
  resolveBedrockRegion,
} from "./bedrock.ts";

export { detectAwsProfiles } from "./bedrock.ts";
export type { AwsProfile } from "./bedrock.ts";

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

// The pi login flow drives an interaction to collect credentials. Most providers
// prompt once (secret/text) for a key; feed the UI-provided value to those prompts.
//
// Some providers open with a `select` naming several auth methods — Amazon Bedrock
// offers a bearer token, an AWS profile, or the ambient credential chain. `method`
// answers that select, and the follow-up prompt takes `value` (the token, or the
// profile name). It must be one of the ids the prompt actually offers, so a UI built
// against a flow the provider has since changed fails loudly rather than picking the
// wrong method. Without it a select still rejects: a multi-field flow must surface as
// an error, not a silently-wrong credential.
export function apiKeyInteraction(value: string, method?: string) {
  return {
    prompt: (
      p: { type: string; options?: readonly { id: string }[] },
    ): Promise<string> => {
      if (p.type === "secret" || p.type === "text") {
        return Promise.resolve(value);
      }
      if (p.type === "select" && method !== undefined) {
        const ids = (p.options ?? []).map((o) => o.id);
        return ids.includes(method) ? Promise.resolve(method) : Promise.reject(
          new Error(
            `auth method "${method}" is not offered (have: ${ids.join(", ")})`,
          ),
        );
      }
      return Promise.reject(
        new Error(`unsupported auth prompt for API-key login: ${p.type}`),
      );
    },
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
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
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
  const available: readonly any[] = await runtime.getAvailable();
  const models = available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
  }));
  // Bedrock ships a static catalog that is mostly unusable in any one region; see
  // bedrock.ts for why the picker is narrowed rather than showing all 114.
  return filterBedrockModels(models, await resolveBedrockRegion());
}

// Persist a credential for a built-in provider via pi's login flow (→ auth.json).
// `value` is whatever that provider's prompt asks for — an API key for most, a bearer
// token or an AWS profile name for Bedrock (see apiKeyInteraction on `method`).
export async function connectProvider(
  id: string,
  value: string,
  method?: string,
): Promise<void> {
  if (value.trim() === "") throw new Error("a credential is required");
  const runtime = await ensureRuntime();
  await runtime.login(id, "api_key", apiKeyInteraction(value.trim(), method));
}

// Connect Bedrock as an AWS profile, storing the profile's own region alongside it.
//
// The region is the part pi cannot work out for itself: it reads AWS_REGION and
// AWS_DEFAULT_REGION only, never the `region =` line in ~/.aws/config. With neither
// set it pins the catalog's baseUrl — us-east-1 for all but ten entries — so a profile
// in any other region silently talks to the wrong one and every model reads as an
// invalid identifier. Storing AWS_REGION in the credential's env fixes that, because
// pi consults the credential env ahead of the process environment.
export async function connectAwsProfile(
  name: string,
  region?: string,
): Promise<void> {
  await connectProvider(BEDROCK, name, "aws-profile");
  if (region) await mergeCredentialEnv(BEDROCK, { AWS_REGION: region });
}

// Add env vars to a stored credential, leaving its type/key and every other provider's
// entry alone. pi's login writes the credential and offers no way to amend it, and the
// Bedrock flow stores only AWS_PROFILE — so the region goes in with a read-modify-write
// of the same file, the way pique already edits models.json next door.
async function mergeCredentialEnv(
  id: string,
  env: Record<string, string>,
): Promise<void> {
  const path = `${home()}/.pi/agent/auth.json`;
  let auth: Record<string, { env?: Record<string, string> }>;
  try {
    auth = JSON.parse(await Deno.readTextFile(path));
  } catch {
    return; // login just wrote this; if it cannot be read back, leave it as it is
  }
  const entry = auth[id];
  if (!entry || typeof entry !== "object") return;
  auth[id] = { ...entry, env: { ...entry.env, ...env } };
  // auth.json holds every provider's secrets — keep it to the owner, as pi does.
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await Deno.writeTextFile(path, JSON.stringify(auth, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function disconnectProvider(id: string): Promise<void> {
  const runtime = await ensureRuntime();
  await runtime.logout(id);
}

// Re-read models.json into the live runtime, so a provider added or removed here is
// served without a restart. `refresh` reloads the config and rebuilds the providers
// before it does anything else, so allowNetwork:false gets that for free while
// skipping the model-catalog fetches, which have nothing to do with this edit.
async function reloadProviders(): Promise<void> {
  await (await ensureRuntime()).refresh({ allowNetwork: false });
}

// Write the endpoint to models.json, then reload so the live runtime serves it.
export async function addCustomProvider(
  input: CustomProviderInput,
): Promise<void> {
  validateCustomInput(input);
  await writeModelsJson(upsertCustomProvider(await readModelsJson(), input));
  await reloadProviders();
}

export async function removeCustomProvider(id: string): Promise<void> {
  const config = await readModelsJson();
  if (!customProviderIds(config).has(id)) {
    throw new Error(`not a custom provider: ${id}`);
  }
  await writeModelsJson(removeProviderFromConfig(config, id));
  await reloadProviders();
}
