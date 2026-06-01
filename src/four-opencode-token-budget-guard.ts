import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { writeDiaryEntry } from "./diary.js";
import { estimateMessageTokens } from "./tokens.js";
import { SessionTokenCache } from "./session-cache.js";
import { TokenBudgetExceededError } from "./errors.js";
import { logDebugEvent } from "./debug-logger.js";
import {
  runPolicyLoop,
  loadPolicyConfig,
  type Policy,
  type PolicyContext,
} from "./policy-engine.js";
import { MaxStartTokensPolicy } from "./policies/max-start-tokens.js";

const sessionTokens = new SessionTokenCache(
  parseInt(process.env.FOUR_TBG_MAX_SESSIONS || "1000", 10),
  parseInt(process.env.FOUR_TBG_SESSION_TTL_MS || String(60 * 60 * 1000), 10),
);

export const FourTokenBudgetGuardPlugin: Plugin = async (_ctx) => {
  const config = loadConfig();
  const policyConfig = loadPolicyConfig();
  const policies: Policy[] = [new MaxStartTokensPolicy()];

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

        // Signal curator to compact via env
        if (config.compactionTrigger) {
          process.env.CC_COMPACTION_TRIGGER = "true";
        }

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
          logDebugEvent("limit.exceeded", {
            limitType: "hard",
            sessionID,
            cumulative,
            softLimit: config.softLimit,
            hardLimit: config.hardLimit,
            tokensApprox,
            msgRole,
            action: "throw",
          });
          throw new TokenBudgetExceededError(
            sessionID,
            cumulative,
            config.hardLimit,
          );
        }

        logDebugEvent("limit.exceeded", {
          limitType: "soft",
          sessionID,
          cumulative,
          softLimit: config.softLimit,
          hardLimit: config.hardLimit,
          tokensApprox,
          msgRole,
          action: "return",
        });

        // Soft limit: log + diary logged above, return
        return;
      }

      // Policy-Loop (after soft/hard check)
      const pCtx: PolicyContext = {
        sessionID,
        cumulative,
        message,
      };

      const policyResults = await runPolicyLoop(policies, pCtx, policyConfig);

      for (const result of policyResults) {
        if (result.level === "enforce") {
          // Signal curator to compact via env
          if (config.compactionTrigger) {
            process.env.CC_COMPACTION_TRIGGER = "true";
          }
          // Write diary BEFORE throw (audit trail)
          await writeDiaryEntry(config.diaryDir, {
            ts: new Date().toISOString(),
            sessionID,
            msgRole: "system",
            tokensApprox: cumulative,
            cumulative,
            softLimit: config.softLimit,
            hardLimit: config.hardLimit,
          });
          logDebugEvent("policy.enforce", {
            policyName: result.name,
            message: result.message,
            sessionID,
            cumulative,
            softLimit: config.softLimit,
            hardLimit: config.hardLimit,
            action: "throw",
          });
          throw new TokenBudgetExceededError(
            sessionID,
            cumulative,
            config.hardLimit,
          );
        }
        if (result.level === "warn") {
          console.warn(`[four-tbg] POLICY WARN: ${result.name} — ${result.message}`);
          logDebugEvent("policy.warn", {
            policyName: result.name,
            message: result.message,
            tokens: result.tokens,
            limit: result.limit,
            sessionID,
            cumulative,
            action: "warn",
          });
        }
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

      logDebugEvent("limit.below", {
        sessionID,
        cumulative,
        softLimit: config.softLimit,
        hardLimit: config.hardLimit,
        tokensApprox,
        msgRole,
        action: "continue",
      });
    },
  };
};

export default FourTokenBudgetGuardPlugin;
