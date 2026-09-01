import { assertEquals } from "@std/assert";
import {
  filterBedrockModels,
  geoPrefixForRegion,
  parseAwsProfiles,
} from "./bedrock.ts";

Deno.test("parseAwsProfiles reads names and regions from ~/.aws/config", () => {
  const config = `[default]
region = us-east-1

[profile work-sso]
sso_session = corp
region = eu-central-1

[sso-session corp]
sso_start_url = https://example.awsapps.com/start
region = us-west-2

[services my-services]
bedrock =
`;
  assertEquals(parseAwsProfiles(config), [
    { name: "default", region: "us-east-1" },
    { name: "work-sso", region: "eu-central-1" },
  ]);
});

Deno.test("parseAwsProfiles keeps a profile without a region, and dedupes", () => {
  assertEquals(parseAwsProfiles("[a]\naws_access_key_id = x\n[b]\n"), [
    { name: "a" },
    { name: "b" },
  ]);
  // A repeated section contributes its region to the one entry.
  assertEquals(parseAwsProfiles("[a]\n[a]\nregion = sa-east-1\n"), [
    { name: "a", region: "sa-east-1" },
  ]);
});

Deno.test("parseAwsProfiles tolerates whitespace, comments and junk", () => {
  assertEquals(parseAwsProfiles(""), []);
  assertEquals(
    parseAwsProfiles("# comment\nnot a section\nregion = us-east-1\n"),
    [],
  );
  assertEquals(parseAwsProfiles("  [  spaced  ]  \n"), [{ name: "spaced" }]);
  assertEquals(parseAwsProfiles("[profile   two words]\n"), [{
    name: "two words",
  }]);
});

Deno.test("geoPrefixForRegion maps only the geographies the catalog ships", () => {
  assertEquals(geoPrefixForRegion("us-east-1"), "us");
  assertEquals(geoPrefixForRegion("EU-WEST-3"), "eu");
  assertEquals(geoPrefixForRegion("ap-northeast-1"), "jp");
  assertEquals(geoPrefixForRegion("ap-southeast-2"), "au");
  // No guessing for a region with no cross-region profiles, or for GovCloud.
  assertEquals(geoPrefixForRegion("ca-central-1"), undefined);
  assertEquals(geoPrefixForRegion("us-gov-west-1"), undefined);
});

// Mirrors the real catalog: a Claude offered both bare and per-geography, a Nova
// offered only bare, and a model routed globally.
const CATALOG = [
  { provider: "amazon-bedrock", id: "anthropic.claude-opus-4-5" },
  { provider: "amazon-bedrock", id: "us.anthropic.claude-opus-4-5" },
  { provider: "amazon-bedrock", id: "eu.anthropic.claude-opus-4-5" },
  { provider: "amazon-bedrock", id: "jp.anthropic.claude-opus-4-5" },
  { provider: "amazon-bedrock", id: "global.anthropic.claude-haiku-4-5" },
  { provider: "amazon-bedrock", id: "anthropic.claude-haiku-4-5" },
  { provider: "amazon-bedrock", id: "amazon.nova-micro-v1:0" },
  { provider: "anthropic", id: "claude-opus-4-5" },
];
const ids = (region: string | undefined) =>
  filterBedrockModels(CATALOG, region).map((m) => m.id);

Deno.test("filterBedrockModels keeps the region's profile and drops other geographies", () => {
  assertEquals(ids("us-east-1"), [
    "us.anthropic.claude-opus-4-5",
    "global.anthropic.claude-haiku-4-5",
    "amazon.nova-micro-v1:0",
    "claude-opus-4-5",
  ]);
  assertEquals(ids("eu-west-1").includes("eu.anthropic.claude-opus-4-5"), true);
  assertEquals(
    ids("eu-west-1").includes("us.anthropic.claude-opus-4-5"),
    false,
  );
});

Deno.test("filterBedrockModels drops a bare id whose inference profile is offered", () => {
  // Both of these throw "on-demand throughput isn't supported" when invoked bare.
  assertEquals(ids("us-east-1").includes("anthropic.claude-opus-4-5"), false);
  assertEquals(ids("us-east-1").includes("anthropic.claude-haiku-4-5"), false);
  // A bare id with no profile variant is genuinely on-demand and survives.
  assertEquals(ids("us-east-1").includes("amazon.nova-micro-v1:0"), true);
});

Deno.test("filterBedrockModels passes non-Bedrock models through untouched", () => {
  assertEquals(ids("us-east-1").includes("claude-opus-4-5"), true);
  const none = filterBedrockModels(
    [{ provider: "openai", id: "gpt-5" }],
    undefined,
  );
  assertEquals(none.length, 1);
});

Deno.test("filterBedrockModels assumes pi's us-east-1 default when no region is set", () => {
  assertEquals(ids(undefined), ids("us-east-1"));
});

Deno.test("filterBedrockModels keeps global profiles in an unmapped region", () => {
  // ca-central-1 reaches no cross-region profiles, so us./eu./jp. all go. The bare
  // haiku goes too, since the global profile serves it. The bare opus STAYS: nothing
  // reachable serves it, and dropping it would hide the model rather than replace it
  // — the filter removes ids that provably cannot work, not ones that merely might.
  assertEquals(ids("ca-central-1"), [
    "anthropic.claude-opus-4-5",
    "global.anthropic.claude-haiku-4-5",
    "amazon.nova-micro-v1:0",
    "claude-opus-4-5",
  ]);
});
