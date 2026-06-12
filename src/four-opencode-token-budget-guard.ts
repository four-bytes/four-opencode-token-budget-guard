import type { Plugin } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { writeDiaryEntry } from "./diary.js";
import { estimateTokens } from "./tokens.js";
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
import { createTokenMeterTool } from "./token-meter.js";
import { BusPublisher } from "./bus-publisher.js";

const sessionTokens = new SessionTokenCache(
  parseInt(process.env.FOUR_TBG_MAX_SESSIONS || "1000", 10),
  parseInt(process.env.FOUR_TBG_SESSION_TTL_MS || String(60 * 60 * 1000), 10),
);

// ── Plugin Bus (P4d) ────────────────────────────────────
const busPublisher = new BusPublisher();
busPublisher.init(); // fire-and-forget — connects if bus available

// Track current session ID (set on first event)
let currentSessionID = "";

export const FourTokenBudgetGuardPlugin: Plugin = async (_ctx) => {
  const config = loadConfig();
  const policyConfig = loadPolicyConfig();
  const policies: Policy[] = [new MaxStartTokensPolicy()];
  let lastDiaryTokenCount = 0;
  let lastWarnTime = 0;
  let firstEventLogged = false;

  async function maybeWriteDiary(
    reason: "below_soft" | "limit_exceeded" | "policy_enforce",
    sessionID: string,
    cumulative: number,
    tokensApprox: number,
    msgRole: string,
  ): Promise<void> {
    if (reason === "below_soft" && cumulative - lastDiaryTokenCount < 5000) return;
    if (reason === "below_soft") lastDiaryTokenCount = cumulative;
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
  }

  if (!config.enabled) {
    return {};
  }

  return {
    event: async (input) => {
      try {
        const ev = input.event;
        if (!firstEventLogged) {
          firstEventLogged = true;
          // eslint-disable-next-line no-console
          console.log(
            `[four-tbg] first event received: type=${ev.type} busConnected=${busPublisher["bus"] !== null}`,
          );
        }
        if (ev.type !== "message.part.updated") return;

        const props = ev.properties as {
          sessionID?: string;
          part?: { type?: string; text?: string };
        };
        const part = props.part;
        if (!part || part.type !== "text" || typeof part.text !== "string") return;

        const sessionID = props.sessionID ?? "unknown";
        currentSessionID = sessionID;
        const tokensApprox = estimateTokens(part.text);
        const cumulative = sessionTokens.add(sessionID, tokensApprox);
        const msgRole = "text-part";

        // Publish to plugin bus (P4d) — fire-and-forget on every token update
        busPublisher.publish(currentSessionID, tokensApprox, sessionTokens, config).catch(() => {});

        if (cumulative >= config.softLimit) {
          const isHard = cumulative >= config.hardLimit;
          const level = isHard ? "HARD" : "SOFT";
          if (Date.now() - lastWarnTime >= 60000) {
            lastWarnTime = Date.now();
            // eslint-disable-next-line no-console
            console.warn(
              `[four-tbg] ${level} limit exceeded — session=${sessionID} tokens=${cumulative} (soft=${config.softLimit}, hard=${config.hardLimit})`,
            );
          }

          // Signal curator to compact via env
          if (config.compactionTrigger) {
            process.env.CC_COMPACTION_TRIGGER = "true";
          }

          // Diary BEFORE throw (audit trail)
          await maybeWriteDiary("limit_exceeded", sessionID, cumulative, tokensApprox, msgRole);

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
        };

        const policyResults = await runPolicyLoop(policies, pCtx, policyConfig);

        for (const result of policyResults) {
          if (result.level === "enforce") {
            // Signal curator to compact via env
            if (config.compactionTrigger) {
              process.env.CC_COMPACTION_TRIGGER = "true";
            }
            // Write diary BEFORE throw (audit trail)
            await maybeWriteDiary("policy_enforce", sessionID, cumulative, cumulative, "system");
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

        // Below soft limit: diary only (throttled)
        await maybeWriteDiary("below_soft", sessionID, cumulative, tokensApprox, msgRole);

        logDebugEvent("limit.below", {
          sessionID,
          cumulative,
          softLimit: config.softLimit,
          hardLimit: config.hardLimit,
          tokensApprox,
          msgRole,
          action: "continue",
        });
      } catch {
        // silent — NEVER throw from event-hook
      }
    },
    tool: {
      token_meter_status: createTokenMeterTool(
        sessionTokens,
        config,
        () => currentSessionID,
      ),
    },
  };
};

export default FourTokenBudgetGuardPlugin;
