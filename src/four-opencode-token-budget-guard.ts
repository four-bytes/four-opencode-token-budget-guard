import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { writeDiaryEntry } from "./diary.js";
import { estimateMessageTokens } from "./tokens.js";
import { SessionTokenCache } from "./session-cache.js";
import { TokenBudgetExceededError } from "./errors.js";

const sessionTokens = new SessionTokenCache(
  parseInt(process.env.FOUR_TBG_MAX_SESSIONS || "1000", 10),
  parseInt(process.env.FOUR_TBG_SESSION_TTL_MS || String(60 * 60 * 1000), 10),
);

export const FourTokenBudgetGuardPlugin: Plugin = async (_ctx) => {
  const config = loadConfig();

  if (!config.enabled) {
    return {};
  }

  return {
    "chat.message": async (input, _output) => {
      const sessionID = (input as { sessionID?: string }).sessionID ?? "unknown";
      const message = (input as { message?: unknown }).message;

      const tokensApprox = estimateMessageTokens(message);
      const cumulative = sessionTokens.add(sessionID, tokensApprox);

      const msgRole =
        (message as { info?: { role?: string } } | undefined)?.info?.role ??
        "unknown";

      if (cumulative >= config.softLimit) {
        const isHard = cumulative >= config.hardLimit;
        const level = isHard ? "HARD" : "SOFT";
        // eslint-disable-next-line no-console
        console.warn(
          `[four-tbg] ${level} limit exceeded — session=${sessionID} tokens=${cumulative} (soft=${config.softLimit}, hard=${config.hardLimit})`,
        );

        // Diary BEFORE throw (audit trail)
        try {
          await writeDiaryEntry(config.diaryDir, {
            ts: new Date().toISOString(),
            sessionID,
            msgRole,
            tokensApprox,
            cumulative,
            softLimit: config.softLimit,
            hardLimit: config.hardLimit,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[four-tbg] diary write failed:", err);
        }

        if (isHard) {
          throw new TokenBudgetExceededError(
            sessionID,
            cumulative,
            config.hardLimit,
          );
        }

        // Soft limit: log + diary logged above, return
        return;
      }

      // Below soft limit: diary only
      try {
        await writeDiaryEntry(config.diaryDir, {
          ts: new Date().toISOString(),
          sessionID,
          msgRole,
          tokensApprox,
          cumulative,
          softLimit: config.softLimit,
          hardLimit: config.hardLimit,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[four-tbg] diary write failed:", err);
      }
    },
  };
};

export default FourTokenBudgetGuardPlugin;
