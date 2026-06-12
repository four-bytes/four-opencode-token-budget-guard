import { tool } from "@opencode-ai/plugin";
import type { SessionTokenCache } from "./session-cache.js";
import type { Config } from "./config.js";

export interface TokenMeterStatus {
  sessionID: string;
  cumulative: number;
  softLimit: number;
  hardLimit: number;
  percentage: number;
  status: "below_soft" | "soft_exceeded" | "hard_exceeded";
}

export function createTokenMeterTool(
  cache: SessionTokenCache,
  config: Config,
  currentSessionID: () => string
) {
  return tool({
    description:
      "Get current session token usage statistics — cumulative tokens, soft/hard limits, percentage, and status.",
    args: {} as const,
    async execute(_args, _context) {
      const sessionID = currentSessionID();
      const cumulative = cache.get(sessionID);

      let percentage = 0;
      if (config.softLimit > 0) {
        percentage = Math.round((cumulative / config.softLimit) * 1000) / 10;
      }

      let status: TokenMeterStatus["status"] = "below_soft";
      if (cumulative >= config.hardLimit) {
        status = "hard_exceeded";
      } else if (cumulative >= config.softLimit) {
        status = "soft_exceeded";
      }

      return {
        output: JSON.stringify({
          sessionID,
          cumulative,
          softLimit: config.softLimit,
          hardLimit: config.hardLimit,
          percentage,
          status,
        }, null, 2),
      };
    },
  });
}
