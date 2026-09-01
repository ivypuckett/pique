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

// Profile names out of an ~/.aws INI file. `~/.aws/config` writes sections as
// `[profile work]` (but `[default]` bare) while `~/.aws/credentials` writes `[work]`,
// so the `profile ` prefix is stripped when present. `[sso-session x]` and
// `[services x]` are config blocks profiles REFER to, not profiles — offering one as
// something to connect would store an AWS_PROFILE that resolves to nothing.
export function parseAwsProfiles(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
    if (!match) continue;
    const name = match[1].replace(/^profile\s+/, "");
    if (/^(sso-session|services)\s/.test(match[1])) continue;
    if (name !== "" && !found.includes(name)) found.push(name);
  }
  return found;
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
      p: { type: string; options?: Array<{ id: string }> },
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

// The AWS profiles configured on this machine, for the Bedrock row in Settings.
//
// pi's own Bedrock detection is environment-only (AWS_PROFILE, access keys, container
// roles); a machine whose credentials live in ~/.aws with nothing exported reads as
// unconfigured even though the SDK chain would authenticate. That is the common case
// for a GUI-launched pique, which does not inherit a shell's exports at all. Listing
// the profiles lets Settings OFFER one — connecting stores it as AWS_PROFILE, which
// is the branch pi's resolve looks for. Detection alone never connects anything:
// binding pique to an AWS account (and its billing) is a click, not a side effect of
// having a credentials file.
export async function detectAwsProfiles(): Promise<string[]> {
  const found: string[] = [];
  for (const file of ["config", "credentials"]) {
    let text: string;
    try {
      text = await Deno.readTextFile(`${home()}/.aws/${file}`);
    } catch {
      continue; // absent or unreadable — that file simply contributes no profiles
    }
    for (const name of parseAwsProfiles(text)) {
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
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
