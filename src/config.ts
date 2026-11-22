export interface Config {
  softLimit: number;
  hardLimit: number;
  /** Percent of the model context window kept free when clamping the hard limit. */
  modelMarginPct: number;
  /** Share of the effective hard limit (percent) that triggers native compaction. */
  compactPct: number;
  /** Minimum interval between native compaction triggers per session (ms). */
  compactCooldownMs: number;
  /** Upper bound for a native `session.summarize()` call (ms). */
  compactTimeoutMs: number;
  diaryDir: string;
  enabled: boolean;
}

export function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Percentage value clamped to [0, 90]. Unlike {@link envInt}, `0` is valid
 * (no margin kept free), so it must not be rejected as "missing".
 */
function envPct(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(90, Math.max(0, n));
}

/**
 * Percentage value clamped to `[min, max]`. Invalid input falls back to
 * `fallback`; a valid value outside the range is clamped into it.
 */
function envPctRange(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function xdgDataHome(): string {
  return (
    process.env.XDG_DATA_HOME ||
    `${process.env.HOME || ""}/.local/share`
  );
}

export function loadConfig(): Config {
  return {
    softLimit: envInt("FOUR_TBG_SOFT_LIMIT", 100_000),
    hardLimit: envInt("FOUR_TBG_HARD_LIMIT", 200_000),
    modelMarginPct: envPct("FOUR_TBG_MODEL_MARGIN_PCT", 10),
    compactPct: envPctRange("FOUR_TBG_COMPACT_PCT", 80, 1, 99),
    compactCooldownMs: envInt("FOUR_TBG_COMPACT_COOLDOWN_MS", 60_000),
    compactTimeoutMs: envInt("FOUR_TBG_COMPACT_TIMEOUT_MS", 30_000),
    diaryDir: `${xdgDataHome()}/four-opencode-token-budget-guard/diary`,
    enabled: process.env.FOUR_TBG_ENABLED !== "false",
  };
}
