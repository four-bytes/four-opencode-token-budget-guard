import type { GrowthParams } from "./agent-config.js";

export interface SoftGrowthAlarm {
  kind: "soft";
  /** Least-squares slope, tokens/turn. */
  slope: number;
  /** Relative growth over the window, as a percentage. */
  growthPctObserved: number;
}

export interface HardGrowthAlarm {
  kind: "hard";
  /** Least-squares slope, tokens/turn. */
  slope: number;
  /** Projected per-turn tokens after projectTurns turns at the current slope. */
  projected: number;
}

export interface GrowthAlarmResult {
  soft: SoftGrowthAlarm | null;
  hard: HardGrowthAlarm | null;
}

/**
 * Least-squares linear fit (tokens/turn) over the series.
 * Returns null for fewer than 2 points; returns 0 for a flat series.
 */
export function linearSlope(values: number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  if (den === 0) return null;
  return num / den;
}

/** Humanize a token count: 162000 → "162k", 3100 → "3.1k", 47 → "47". */
export function humanizeTokens(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = abs / 1000;
    const rounded = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
    return `${sign}${rounded}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

/** Format a slope as "+3.1k/turn" (sign-prefixed, human-formatted). */
export function formatSlope(slope: number): string {
  const prefix = slope >= 0 ? "+" : "";
  return `${prefix}${humanizeTokens(slope)}/turn`;
}

/**
 * Compute the context-growth slope alarm over the trailing growthWindow turns.
 *
 * The series is the CUMULATIVE context size at each turn boundary (not per-turn
 * deltas), so it grows toward the context window and both alarms are reachable.
 *
 * - **soft**: cumulative context grew by more than `growthPct`% over the window
 *   (`(last - first) / first × 100`).
 * - **hard**: the most recent cumulative value projected forward `projectTurns`
 *   turns at the least-squares slope (`last + slope * projectTurns`) reaches
 *   `contextWindow`.
 *
 * No alarm is raised until at least `growthWindow` turns of history exist, and
 * only for positive growth.
 */
export function computeGrowthAlarm(
  history: number[],
  params: GrowthParams,
): GrowthAlarmResult {
  const result: GrowthAlarmResult = { soft: null, hard: null };
  if (history.length < params.growthWindow) return result;

  const window = history.slice(-params.growthWindow);
  const first = window[0];
  const last = window[window.length - 1];
  const slope = linearSlope(window);

  if (first > 0) {
    const growthPctObserved = ((last - first) / first) * 100;
    if (growthPctObserved > params.growthPct) {
      result.soft = { kind: "soft", slope: slope ?? 0, growthPctObserved };
    }
  }

  if (slope !== null && slope > 0) {
    const projected = last + slope * params.projectTurns;
    if (projected >= params.contextWindow) {
      result.hard = { kind: "hard", slope, projected };
    }
  }

  return result;
}
