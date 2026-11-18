import { tool } from "@opencode-ai/plugin";
import type { Config } from "./config.js";
import { budgetBasis, type MetricsTracker } from "./metrics.js";

export interface TokenMeterStatus {
  sessionID: string;
  /** chars/4 estimate of the current conversation text. */
  contextEstimate: number;
  /** chars/4 estimate of assistant text deltas generated this session. */
  generatedEstimate: number;
  /** Authoritative cumulative usage over completed steps. */
  cumulativeUsage: number;
  /** Authoritative cache tokens from the latest usage report. */
  cache: { read: number; write: number };
  /**
   * The value the budget guard enforces against (authoritative context usage,
   * falling back to the text estimate). Pre-request enforcement additionally
   * adds the pending user-part tokens of the request being sent; `status` and
   * `percentage` are derived from `budgetBasis` alone and leave them out.
   */
  budgetBasis: number;
  /** Backward-compatible alias for `budgetBasis`. */
  cumulative: number;
  softLimit: number;
  hardLimit: number;
  percentage: number;
  status: "below_soft" | "soft_exceeded" | "hard_exceeded";
}

export function createTokenMeterTool(
  metrics: MetricsTracker,
  config: Config,
  currentSessionID: () => string,
) {
  return tool({
    description:
      "Get current session token usage — separate estimates (context/generated), authoritative cumulative usage and cache metrics, plus the enforced budget basis and limit status.",
    args: {} as const,
    async execute(_args, _context) {
      const sessionID = currentSessionID();
      const m = metrics.get(sessionID);
      const basis = budgetBasis(m);

      let percentage = 0;
      if (config.softLimit > 0) {
        percentage = Math.round((basis / config.softLimit) * 1000) / 10;
      }

      let status: TokenMeterStatus["status"] = "below_soft";
      if (basis >= config.hardLimit) {
        status = "hard_exceeded";
      } else if (basis >= config.softLimit) {
        status = "soft_exceeded";
      }

      const payload: TokenMeterStatus = {
        sessionID,
        contextEstimate: m.contextEstimate,
        generatedEstimate: m.generatedEstimate,
        cumulativeUsage: m.cumulativeUsage,
        cache: { read: m.cacheRead, write: m.cacheWrite },
        budgetBasis: basis,
        cumulative: basis,
        softLimit: config.softLimit,
        hardLimit: config.hardLimit,
        percentage,
        status,
      };

      return {
        output: JSON.stringify(payload, null, 2),
      };
    },
  });
}
