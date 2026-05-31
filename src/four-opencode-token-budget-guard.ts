import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { writeDiaryEntry } from "./diary.js";
import { estimateMessageTokens } from "./tokens.js";

const sessionTokens = new Map<string, number>();

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
      const cumulative = (sessionTokens.get(sessionID) ?? 0) + tokensApprox;
      sessionTokens.set(sessionID, cumulative);

      const msgRole =
        (message as { info?: { role?: string } } | undefined)?.info?.role ??
        "unknown";

      if (cumulative >= config.softLimit) {
        const level = cumulative >= config.hardLimit ? "HARD" : "SOFT";
        // eslint-disable-next-line no-console
        console.warn(
          `[four-tbg] ${level} limit exceeded — session=${sessionID} tokens=${cumulative} (soft=${config.softLimit}, hard=${config.hardLimit})`,
        );
        // TODO: actual hard-cancel mechanism — opencode plugin-API for request cancellation
        // currently unclear. See follow-up issue.
      }

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
