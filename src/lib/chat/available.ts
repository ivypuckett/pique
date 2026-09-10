// Listing every connected provider's models WITHOUT letting one broken provider hide
// the rest. Runs in the desktop process only.
//
// pi's own `getAvailable()` — the no-argument form — fans out across every provider
// under a single Promise.all (pi-ai's models.js), and ModelRuntime.runAvailabilityRefresh
// does the same for the auth checks. One provider that cannot resolve its credentials
// therefore rejects the WHOLE call, and leaves the runtime's snapshot untouched: its
// `configuredProviders` stays empty, so every other provider reads as unconfigured too.
// Expired credentials are an everyday state — an AWS SSO session lapses daily — so a
// provider in that state must cost the user that provider and nothing else.
//
// Asking one provider at a time costs an extra call each and confines the failure to
// where it belongs. The reasons are kept rather than dropped: nothing else in the stack
// records WHY a provider vanished, and a chat that silently lost half its picker is the
// symptom this exists to prevent.
//
// Pure over the runtime slice it needs, so the fan-out is testable against a provider
// that throws (available_test.ts) without standing up a ModelRuntime.

export type ProviderModel = { provider: string; id: string; name: string };

// The slice of pi's ModelRuntime this needs. Structural, so the real runtime satisfies
// it without an import — and so a test can hand over a provider that rejects.
export type ModelSource = {
  getProviders(): readonly { id: string }[];
  getAvailable(
    providerId: string,
  ): Promise<readonly { provider: string; id: string; name?: string }[]>;
};

export type Availability = {
  models: ProviderModel[];
  // Provider id → the reason its models could not be listed. Empty when all answered.
  failed: Map<string, string>;
};

export async function availableModels(
  source: ModelSource,
): Promise<Availability> {
  const failed = new Map<string, string>();
  const perProvider = await Promise.all(
    source.getProviders().map(async (provider) => {
      try {
        return await source.getAvailable(provider.id);
      } catch (error) {
        failed.set(
          provider.id,
          error instanceof Error ? error.message : String(error),
        );
        return [];
      }
    }),
  );
  const models = perProvider.flat().map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
  }));
  return { models, failed };
}

// The same fan-out, with each provider that dropped out reported to the desktop log.
// The log line is the only place the reason surfaces today: the pickers show what
// resolved, and pi records nothing once its own all-or-nothing call is bypassed.
export async function listAvailableModels(
  source: ModelSource,
): Promise<ProviderModel[]> {
  const { models, failed } = await availableModels(source);
  for (const [id, reason] of failed) {
    console.warn(`providers: ${id} offered no models: ${reason}`);
  }
  return models;
}
