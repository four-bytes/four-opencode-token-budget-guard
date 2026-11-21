/**
 * Model-aware limit resolution.
 *
 * The hard limit may be clamped to the context window of the model a request
 * is actually sent to, so a fixed default can never be larger than what the
 * provider can accept. Structurally typed on purpose: no dependency on the
 * generated SDK types.
 */

export interface ModelProviderInfo {
  id: string;
  models?: Record<string, { limit?: { context?: number } }>;
}

export interface EffectiveLimits {
  softLimit: number;
  hardLimit: number;
}

/**
 * Resolve the context window (tokens) for `providerID`/`modelID`.
 * Returns `null` when the provider or model is unknown, or the value is not
 * a positive number.
 */
export function resolveModelContextLimit(
  providers: readonly ModelProviderInfo[],
  providerID: string,
  modelID: string,
): number | null {
  const provider = providers.find((p) => p.id === providerID);
  if (!provider?.models) return null;
  const context = provider.models[modelID]?.limit?.context;
  return typeof context === "number" && Number.isFinite(context) && context > 0
    ? context
    : null;
}

/**
 * Clamp the configured limits to `modelContext` (when known).
 *
 * The hard limit keeps `marginPct` percent of the context window free and never
 * rises above the configured hard limit; the soft limit never rises above the
 * resulting hard limit.
 */
export function effectiveLimits(
  configuredSoft: number,
  configuredHard: number,
  marginPct: number,
  modelContext: number | null,
): EffectiveLimits {
  if (modelContext === null || !Number.isFinite(modelContext) || modelContext <= 0) {
    return { softLimit: configuredSoft, hardLimit: configuredHard };
  }
  const usable = Math.max(
    1,
    Math.floor((modelContext * (100 - marginPct)) / 100),
  );
  const hardLimit = Math.min(configuredHard, usable);
  const softLimit = Math.min(configuredSoft, hardLimit);
  return { softLimit, hardLimit };
}
