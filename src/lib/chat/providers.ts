// Deno-side model-provider management. Runs in the desktop process only.
//
// "Provider agnostic like pi": pique exposes pi's own two connection mechanisms
// over win.bind, so any provider pi supports can be connected from the UI —
//   • API keys for built-in cloud providers (anthropic, openai, google, …),
//     persisted via runtime.login() → auth.json in the agent dir (paths.ts).
//   • Custom OpenAI-compatible endpoints (LM Studio, Ollama, vLLM, …), written
//     as models.json provider entries there — the SAME shape the `pi` CLI uses.
// Mutations run against the one shared ModelRuntime (see chat/agent.ts) so they take
// effect without a restart.
//
// The frontend half is the provider* win.bind handlers in src/desktop.ts; keep
// arg/return shapes in sync by hand (separate module graphs, as with chat/ext).

import { dirname } from "@std/path";
import { ensureRuntime } from "./agent.ts";
import { listAvailableModels } from "./available.ts";
import { agentDir } from "../paths.ts";

// The one provider with a setting pi's login never asks for: its AWS region (see
// setBedrockRegion).
const BEDROCK = "amazon-bedrock";

// JSON-safe projection of a pi Provider for the Settings UI.
export type ProviderInfo = {
  id: string;
  name: string;
  configured: boolean; // has usable auth (stored key, env var, or keyless local)
  canApiKey: boolean; // supports interactive API-key login
  isCustom: boolean; // defined by a models.json entry pique can remove
  // Where that auth comes from, straight from pi's AuthStatus: "stored" is the
  // credential in auth.json — the only one Disconnect can remove — while
  // "environment" is an ambient variable (AWS_PROFILE, ANTHROPIC_API_KEY, …) that
  // pique has no way to unset. Absent when unconfigured.
  source?: string;
  // What the environment offered, when that is the source: the variable's name.
  sourceLabel?: string;
  // Bedrock only: the AWS_REGION stored with its credential, if any.
  region?: string;
};

// One model the runtime can serve, addressed the way a stored `provider/model-id` ref
// is. Distinct from chat/agent.ts's ModelInfo, which also marks which one a LIVE chat
// session is on: the Settings checklist has no session behind it.
export type ModelOption = { provider: string; id: string; name: string };

// A user-defined OpenAI-compatible endpoint, as entered in the Settings form.
export type CustomProviderInput = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
};

// The parsed models.json. Only `providers` is touched; any other
// keys the user (or pi) put there are preserved on write.
type ModelsJson = { providers?: Record<string, unknown>; [k: string]: unknown };

// Provider ids key a models.json object and are used in model refs, so keep them
// to a conservative, path-safe set (matches how pi ids look: "lmstudio", "xai").
const PROVIDER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// --- Pure helpers (unit-tested; no runtime/filesystem) -----------------------

// `status` is pi's AuthStatus for this provider (see listProviders).
export function toProviderInfo(
  // deno-lint-ignore no-explicit-any
  provider: any,
  status: { configured: boolean; source?: string; label?: string },
  isCustom: boolean,
): ProviderInfo {
  const name = typeof provider?.name === "string" && provider.name
    ? provider.name
    : String(provider?.id);
  return {
    id: String(provider?.id),
    name,
    configured: status.configured,
    canApiKey: Boolean(provider?.auth?.apiKey?.login),
    isCustom,
    source: status.source,
    sourceLabel: status.label,
  };
}

// pi answers "is this provider configured?" out of a snapshot that its all-or-nothing
// availability refresh leaves EMPTY whenever any ONE provider throws (see available.ts).
// Every provider then reads as disconnected at once: Settings offers to connect what is
// already connected, and pi's own gate refuses a send with "Provider is not configured".
//
// So an unconfigured-looking provider is asked again without the snapshot in the way,
// and this folds that answer back into an AuthStatus with the precedence pi itself uses:
// a stored credential first (which is what earns the Disconnect button), then whatever a
// live auth check found — the environment, for the AWS_PROFILE and ANTHROPIC_API_KEY case.
export function authStatusFallback(
  stored: boolean,
  check: { source?: string } | undefined,
): { configured: boolean; source?: string; label?: string } {
  if (stored) return { configured: true, source: "stored" };
  return check
    ? { configured: true, source: "environment", label: check.source }
    : { configured: false };
}

// Stands in for the API key of an endpoint that does not use one. pi treats a custom
// provider with no `apiKey` as unconfigured and drops its models from getAvailable(),
// so a keyless local server — LM Studio, Ollama, the very examples this feature exists
// for — would save fine and then offer nothing to pick. Those servers ignore the value,
// so writing one costs nothing and makes the provider resolve.
//
// Deliberately a plain word: pi reads `${VAR}` in this field as an environment lookup
// and a shell-shaped value as a command to run, and this must be neither.
const NO_API_KEY = "not-required";

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
    apiKey: apiKey ? apiKey : NO_API_KEY,
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

// One step of a provider's login, as the Settings card renders it: the prompt pi is
// waiting on, plus whatever it said along the way. Every provider's login is built out
// of these — most ask for one secret, Amazon Bedrock opens by selecting between a
// bearer token, an AWS profile and the ambient credential chain — so the card shows
// them as asked rather than knowing any provider's flow in advance.
export type LoginPrompt = {
  type: "text" | "secret" | "select";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
};
export type LoginNote = {
  message: string;
  links: { url: string; label?: string }[];
};
export type LoginStep =
  | { done: true }
  | { done: false; prompt: LoginPrompt; notes: LoginNote[] };

type AuthPrompt = {
  type: string;
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
};
type AuthEvent = {
  type: string;
  message?: string;
  links?: readonly { url: string; label?: string }[];
};
export type LoginInteraction = {
  prompt(p: AuthPrompt): Promise<string>;
  notify(e: AuthEvent): void;
};

// A login in progress, paused at each prompt until the UI answers it. `next()` is the
// step the flow is on; `answer()` resumes it and resolves with the step after. A login
// that throws rejects the pending step, which is how a bad key reaches the card.
export class LoginFlow {
  #notes: LoginNote[] = [];
  #pending?: { resolve(v: string): void; reject(e: Error): void };
  #next!: Promise<LoginStep>;
  #settle!: (step: LoginStep) => void;
  #fail!: (e: unknown) => void;

  constructor(run: (interaction: LoginInteraction) => Promise<unknown>) {
    this.#arm();
    run({
      prompt: (p) =>
        new Promise((resolve, reject) => {
          this.#pending = { resolve, reject };
          this.#settle({
            done: false,
            prompt: toLoginPrompt(p),
            notes: this.#take(),
          });
        }),
      notify: (e) => {
        if (e.message) {
          this.#notes.push({ message: e.message, links: [...(e.links ?? [])] });
        }
      },
    }).then(() => this.#settle({ done: true }), (e) => this.#fail(e));
  }

  #arm(): void {
    this.#next = new Promise((resolve, reject) => {
      this.#settle = resolve;
      this.#fail = reject;
    });
    // A cancelled flow rejects a step nobody is waiting on; that is not an error.
    this.#next.catch(() => {});
  }

  #take(): LoginNote[] {
    const notes = this.#notes;
    this.#notes = [];
    return notes;
  }

  next(): Promise<LoginStep> {
    return this.#next;
  }

  answer(value: string): Promise<LoginStep> {
    const pending = this.#pending;
    if (!pending) throw new Error("the login is not waiting on an answer");
    this.#pending = undefined;
    this.#arm();
    pending.resolve(value);
    return this.#next;
  }

  cancel(): void {
    this.#pending?.reject(new Error("login cancelled"));
    this.#pending = undefined;
  }
}

// pi's `manual_code` prompt is a text box by another name (it belongs to OAuth, which
// this card does not run, but costs nothing to accept).
export function toLoginPrompt(p: AuthPrompt): LoginPrompt {
  const type = p.type === "secret" || p.type === "select" ? p.type : "text";
  return {
    type,
    message: p.message,
    placeholder: p.placeholder,
    options: p.options?.map((o) => ({ ...o })),
  };
}

// --- Runtime + models.json plumbing ------------------------------------------

function piModelsPath(): string {
  return `${agentDir()}/models.json`;
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
  // Both fallback inputs are read once, off the credential store rather than the
  // snapshot; a store that cannot be read leaves the stored set empty, which is what
  // the snapshot already assumed.
  const stored = new Set<string>();
  try {
    for (const entry of await runtime.listCredentials()) {
      stored.add(entry.providerId);
    }
  } catch { /* no stored credentials to add — the live check still speaks */ }
  const region = (await readAuthJson())[BEDROCK]?.env?.AWS_REGION;
  return await Promise.all(
    runtime.getProviders().map(async (p: { id: string }) => {
      const status = runtime.getProviderAuthStatus(p.id);
      const info = toProviderInfo(
        p,
        status.configured ? status : authStatusFallback(
          stored.has(p.id),
          await checkAuth(runtime, p.id),
        ),
        custom.has(p.id),
      );
      return p.id === BEDROCK ? { ...info, region } : info;
    }),
  );
}

// One provider's live auth check. Throwing is the state this whole path exists for —
// it is what empties pi's snapshot — so a provider that cannot answer reads as
// unconfigured on its own rather than taking the other providers down with it.
async function checkAuth(
  runtime: { checkAuth(id: string): Promise<{ source?: string } | undefined> },
  id: string,
): Promise<{ source?: string } | undefined> {
  try {
    return await runtime.checkAuth(id);
  } catch {
    return undefined;
  }
}

// Every model the connected providers offer. Session-independent, which is what makes
// it usable from a picker that is choosing a model for a run that does not exist yet.
export async function listModels(): Promise<ModelOption[]> {
  return await listAvailableModels(await ensureRuntime());
}

// The one login the Settings card is running. Starting another abandons it.
let login: LoginFlow | undefined;

// Begin a provider's login through pi (→ auth.json), returning its first prompt.
export async function loginStart(id: string): Promise<LoginStep> {
  login?.cancel();
  const runtime = await ensureRuntime();
  const flow = new LoginFlow((i) => runtime.login(id, "api_key", i));
  login = flow;
  return await settle(flow, flow.next());
}

export async function loginAnswer(value: string): Promise<LoginStep> {
  if (!login) throw new Error("no login is in progress");
  return await settle(login, login.answer(value));
}

export function loginCancel(): void {
  login?.cancel();
  login = undefined;
}

// A finished or failed login is no longer the one in progress.
async function settle(
  flow: LoginFlow,
  step: Promise<LoginStep>,
): Promise<LoginStep> {
  try {
    const result = await step;
    if (result.done && login === flow) login = undefined;
    return result;
  } catch (e) {
    if (login === flow) login = undefined;
    throw e;
  }
}

// Store the AWS region Bedrock calls go to, alongside its stored credential; blank
// removes it.
//
// pi's login never asks for one, and does not read the `region =` line in ~/.aws/config
// either: with no AWS_REGION it sends a stored profile or bearer token to the model's
// catalog endpoint, us-east-1 for nearly everything, and a profile set up anywhere else
// fails as an invalid model identifier. pi reads the credential's env ahead of the
// process environment, so a region stored there reaches every call.
export async function setBedrockRegion(region: string): Promise<void> {
  const auth = await readAuthJson();
  const entry = auth[BEDROCK];
  if (!entry || typeof entry !== "object") {
    throw new Error("connect Amazon Bedrock before setting its region");
  }
  const env = { ...entry.env };
  if (region.trim() === "") delete env.AWS_REGION;
  else env.AWS_REGION = region.trim();
  auth[BEDROCK] = { ...entry, env };
  // auth.json holds every provider's secrets — keep it to the owner, as pi does.
  const path = authJsonPath();
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await Deno.writeTextFile(path, JSON.stringify(auth, null, 2) + "\n", {
    mode: 0o600,
  });
}

function authJsonPath(): string {
  return `${agentDir()}/auth.json`;
}

// pi's credential store. pi's own API writes a credential whole and offers no way to
// amend one, so the region goes in with a read-modify-write of the same file, the way
// pique already edits models.json next door. Missing or corrupt reads as empty.
async function readAuthJson(): Promise<
  Record<string, { env?: Record<string, string> }>
> {
  try {
    return JSON.parse(await Deno.readTextFile(authJsonPath()));
  } catch {
    return {};
  }
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
