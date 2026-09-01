// Amazon Bedrock specifics. Runs in the desktop process only.
//
// pique is otherwise provider-agnostic (see providers.ts), and this module is the
// deliberate exception: Bedrock is the one provider whose model list is largely
// unusable as shipped, for two reasons worth writing down.
//
//  • pi's Bedrock catalog is STATIC — the provider defines no refreshModels, so the
//    114 entries are a hand-maintained list, not what your account can invoke. Most
//    are wrong for any given user: the `jp.*` and `au.*` entries even carry a
//    us-east-1 baseUrl, where those inference profiles do not exist, so they fail for
//    everyone. Picking one yields "The provided model identifier is invalid".
//  • The newer models are not served on demand by their bare id at all; AWS requires
//    the region-prefixed INFERENCE PROFILE (`us.anthropic.…` rather than
//    `anthropic.…`). Picking the bare id yields "Invocation of model id … with
//    on-demand throughput isn't supported".
//
// So the picker is filtered to what can plausibly work in the user's region. This is
// a heuristic over ids, not a live check against AWS: it cannot know which models the
// account has actually enabled in the Bedrock console, and a model enabled there but
// missing from pi's static catalog stays invisible. It removes the entries that
// CANNOT work, which is most of them.
//
// This module reads (~/.aws, and the region out of pi's auth.json); providers.ts owns
// every write to ~/.pi. That split is what keeps agent.ts able to import the filter
// without a cycle through providers.ts → agent.ts.

import { home } from "../home.ts";

export const BEDROCK = "amazon-bedrock";

// One entry from ~/.aws. `region` is the profile's own `region =` line, which is the
// piece pi never reads on its own (it consults AWS_REGION/AWS_DEFAULT_REGION only, so
// a profile-only setup silently falls back to the catalog's us-east-1).
export type AwsProfile = { name: string; region?: string };

// Profile names and regions out of an ~/.aws INI file. `~/.aws/config` writes sections
// as `[profile work]` (but `[default]` bare) while `~/.aws/credentials` writes
// `[work]`, so the `profile ` prefix is stripped when present. `[sso-session x]` and
// `[services x]` are blocks profiles REFER to, not profiles — offering one would store
// an AWS_PROFILE that resolves to nothing.
export function parseAwsProfiles(text: string): AwsProfile[] {
  const found: AwsProfile[] = [];
  let current: AwsProfile | undefined;
  for (const line of text.split("\n")) {
    const section = /^\s*\[\s*([^\]]+?)\s*\]/.exec(line);
    if (section) {
      const raw = section[1];
      if (/^(sso-session|services)\s/.test(raw)) {
        current = undefined; // inside a non-profile block: ignore its keys too
        continue;
      }
      const name = raw.replace(/^profile\s+/, "");
      if (name === "") {
        current = undefined;
        continue;
      }
      current = found.find((p) => p.name === name);
      if (!current) {
        current = { name };
        found.push(current);
      }
      continue;
    }
    const region = /^\s*region\s*=\s*(\S+)/.exec(line);
    if (region && current && current.region === undefined) {
      current.region = region[1];
    }
  }
  return found;
}

// The profiles configured on this machine. Both files contribute; a profile named in
// each is one entry, taking the first region either one gives it.
export async function detectAwsProfiles(): Promise<AwsProfile[]> {
  const found: AwsProfile[] = [];
  for (const file of ["config", "credentials"]) {
    let text: string;
    try {
      text = await Deno.readTextFile(`${home()}/.aws/${file}`);
    } catch {
      continue; // absent or unreadable — that file contributes no profiles
    }
    for (const profile of parseAwsProfiles(text)) {
      const existing = found.find((p) => p.name === profile.name);
      if (!existing) found.push(profile);
      else existing.region ??= profile.region;
    }
  }
  return found;
}

// The id prefix naming the cross-region inference profiles an AWS region can reach.
// Only the geographies pi's catalog actually ships are mapped; anything else (say
// ca-central-1) gets no prefixed models rather than a wrong guess.
export function geoPrefixForRegion(region: string): string | undefined {
  const r = region.toLowerCase();
  if (r.startsWith("us-gov-")) return undefined; // GovCloud uses its own us-gov. ids
  if (r.startsWith("us-")) return "us";
  if (r.startsWith("eu-")) return "eu";
  if (r === "ap-northeast-1") return "jp";
  if (r === "ap-southeast-2") return "au";
  return undefined;
}

// Every geography prefix the catalog uses, so a bare id can be told apart from a
// prefixed one without guessing.
const GEO_PREFIXES = ["us", "eu", "jp", "au", "global"];

function prefixOf(id: string): string | undefined {
  const head = id.split(".")[0];
  return GEO_PREFIXES.includes(head) ? head : undefined;
}

// Narrow a model list to the Bedrock entries that can work in `region`. Non-Bedrock
// models pass through untouched, so this is safe to run over the whole list.
//
// `region` undefined means nothing is configured, and pi itself then falls back to
// us-east-1 — so the filter assumes the same rather than showing everything.
export function filterBedrockModels<T extends { provider: string; id: string }>(
  models: readonly T[],
  region: string | undefined,
): T[] {
  const geo = geoPrefixForRegion(region ?? "us-east-1");
  const bedrock = models.filter((m) => m.provider === BEDROCK);
  // `global.` profiles route from anywhere, so they survive whatever the region is.
  const kept = bedrock.filter((m) => {
    const prefix = prefixOf(m.id);
    return prefix === undefined || prefix === geo || prefix === "global";
  });
  const keptIds = new Set(kept.map((m) => m.id));
  return models.filter((m) => {
    if (m.provider !== BEDROCK) return true;
    if (!keptIds.has(m.id)) return false;
    // A bare id whose inference profile is also on offer is the variant AWS refuses to
    // serve on demand — drop it so the picker shows the one that works. A bare id with
    // no profile variant (Nova, some Mistral) is genuinely on-demand and stays.
    if (prefixOf(m.id) !== undefined) return true;
    return !keptIds.has(`${geo}.${m.id}`) && !keptIds.has(`global.${m.id}`);
  });
}

// The region Bedrock calls will actually use, by the same precedence pi applies:
// AWS_REGION, then AWS_DEFAULT_REGION, then whatever was stored with the connected
// profile. Undefined when nothing says — the caller treats that as pi's us-east-1
// default rather than inventing one.
export async function resolveBedrockRegion(): Promise<string | undefined> {
  const fromEnv = Deno.env.get("AWS_REGION") ??
    Deno.env.get("AWS_DEFAULT_REGION");
  if (fromEnv) return fromEnv;
  try {
    const auth = JSON.parse(
      await Deno.readTextFile(`${home()}/.pi/agent/auth.json`),
    );
    const region = auth?.[BEDROCK]?.env?.AWS_REGION;
    return typeof region === "string" && region !== "" ? region : undefined;
  } catch {
    return undefined; // no auth.json, or not connected — nothing to say
  }
}
