import type { Plugin } from "@opencode-ai/plugin";
import { envInt, loadConfig } from "./config.js";
import { writeDiaryEntry } from "./diary.js";
import { estimateTokens } from "./tokens.js";
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
import {
  AgentBudgetResolver,
  evaluatePerTurnThreshold,
  loadBudgetConfig,
  loadGrowthParams,
} from "./agent-config.js";
import { TurnTracker } from "./turn-tracker.js";
import { computeGrowthAlarm, formatSlope } from "./growth.js";
import { readTopSource } from "./growth-source.js";
import {
  MetricsTracker,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_SESSION_TTL_MS,
  budgetBasis,
  type UsageTokens,
} from "./metrics.js";

// ── Plugin Bus (P4d) ────────────────────────────────────
const busPublisher = new BusPublisher();
// init() is called inside the Plugin callback once ctx.client is available

// Per-session turn state (agent name, per-turn accumulator, turn history)
const turnTracker = new TurnTracker();

// Distinct token metrics per session (context estimate, generated estimate,
// authoritative cumulative usage and cache metrics). Bounded via env, defaults
// are 1000 sessions / 7 days idle TTL.
const metrics = new MetricsTracker(
  envInt("FOUR_TBG_MAX_SESSIONS", DEFAULT_MAX_SESSIONS),
  envInt("FOUR_TBG_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS),
);

// Track current session ID (set on first event)
let currentSessionID = "";

/** Minimum interval between soft/hard warnings for the same key. */
const WARN_INTERVAL_MS = 60_000;
/** Minimum interval between ordinary (turn-boundary) diary writes. */
const DIARY_MIN_INTERVAL_MS = 30_000;
/** Minimum budget-basis change before writing another ordinary diary entry. */
const DIARY_MIN_TOKEN_DELTA = 5_000;

export const FourTokenBudgetGuardPlugin: Plugin = async (ctx) => {
  const config = loadConfig();
  // Initialize bus publisher with app.log for warning messages
  await busPublisher.init({
    onWarn: (msg, ...args) => {
      ctx.client.app.log({
        body: {
          service: "tbg",
          level: "warn",
          message: msg,
          extra: { details: args.map(a => {
            if (typeof a !== 'object' || a === null) return String(a);
            try {
              return JSON.stringify(a);
            } catch {
              return "[unserializable]";
            }
          }).join(" ") }
        }
      }).catch(() => {});
    }
  });
  logDebugEvent("plugin.loaded", { directory: ctx.directory });
  const directory = (ctx as { directory?: string }).directory;
  const budgetConfig = loadBudgetConfig(directory);
  const agentBudgets = new AgentBudgetResolver(budgetConfig.agents, (agent) => {
    logDebugEvent("config.unknown_agent", { agent });
  });
  const growthParams = loadGrowthParams(budgetConfig.growth);
  const policyConfig = loadPolicyConfig();
  const policies: Policy[] = [new MaxStartTokensPolicy()];

  // ── Debounce state ─────────────────────────────────────
  // Warnings: per session+level (60 s).
  const warnState = new Map<string, number>();
  // Diary: per session, throttled by time AND budget-basis change.
  const diaryState = new Map<string, { ts: number; tokens: number }>();

  function shouldWarn(key: string, intervalMs = WARN_INTERVAL_MS): boolean {
    const last = warnState.get(key) ?? 0;
    if (Date.now() - last < intervalMs) return false;
    warnState.set(key, Date.now());
    return true;
  }

  function safeToast(body: {
    title: string;
    message: string;
    variant: "info" | "warning" | "error";
    duration?: number;
  }): void {
    try {
      // showToast returns a promise and may reject asynchronously; swallow the
      // rejection too, not just synchronous throws.
      void Promise.resolve(
        ctx.client.tui.showToast({ body: { ...body, duration: body.duration ?? 7000 } }),
      ).catch(() => {});
    } catch {
      // Never let a UI failure break measurement or enforcement.
    }
  }

  async function maybeWriteDiary(
    reason: "turn" | "limit_exceeded" | "policy_enforce",
    sessionID: string,
    msgRole: string,
    /** Budget basis including the incoming request, computed by the caller. */
    basis: number,
    force = false,
  ): Promise<void> {
    const m = metrics.get(sessionID);
    const now = Date.now();
    const last = diaryState.get(sessionID);

    if (
      !force &&
      last &&
      now - last.ts < DIARY_MIN_INTERVAL_MS &&
      Math.abs(basis - last.tokens) < DIARY_MIN_TOKEN_DELTA
    ) {
      return;
    }
    diaryState.set(sessionID, { ts: now, tokens: basis });

    try {
      await writeDiaryEntry(config.diaryDir, {
        ts: new Date().toISOString(),
        sessionID,
        msgRole,
        tokensApprox: basis,
        cumulative: basis,
        softLimit: config.softLimit,
        hardLimit: config.hardLimit,
        reason,
        contextEstimate: m.contextEstimate,
        generatedEstimate: m.generatedEstimate,
        cumulativeUsage: m.cumulativeUsage,
        cacheRead: m.cacheRead,
        cacheWrite: m.cacheWrite,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[four-tbg] diary write failed (${reason}):`, err);
    }
  }

  /** Per-turn threshold: soft/hard warn (never throw) against the agent budget. */
  function checkPerTurnThreshold(sessionID: string, turnTokens: number): void {
    const agent = turnTracker.getAgent(sessionID) ?? "unknown";
    const budget = agentBudgets.resolve(agent);
    const level = evaluatePerTurnThreshold(turnTokens, budget);
    if (!level) return;

    const key = `${sessionID}:per-turn:${level}`;
    if (!shouldWarn(key)) return;

    const limit = level === "hard" ? budget.hardPerTurn : budget.softPerTurn;
    const turnNumber = turnTracker.getTurnNumber(sessionID);
    const message = `[${agent}] turn ${turnNumber}: ${turnTokens} tokens exceed ${level === "hard" ? "hardPerTurn" : "softPerTurn"} ${limit}`;
    logDebugEvent("per_turn.limit_exceeded", {
      level,
      agent,
      sessionID,
      turnNumber,
      turnTokens,
      limit,
    });
    safeToast({
      title: "Per-Turn Budget ⚠️",
      message,
      variant: level === "hard" ? "error" : "warning",
    });
  }

  /** Context-growth slope alarm (soft/hard), evaluated at turn boundaries. */
  function checkSlopeAlarm(sessionID: string, agent: string | null): void {
    const history = turnTracker.getHistory(sessionID);
    const alarm = computeGrowthAlarm(history, growthParams);
    const agentLabel = agent ?? "unknown";

    if (alarm.hard) {
      const key = `${sessionID}:slope:hard`;
      if (shouldWarn(key)) {
        const top = readTopSource(sessionID);
        const cause = top ? ` · top source: ${top.tool} (${top.pct}%)` : "";
        const message = `context growing ${formatSlope(alarm.hard.slope)}${cause}`;
        logDebugEvent("growth.hard_alarm", {
          agent: agentLabel,
          sessionID,
          slope: alarm.hard.slope,
          projected: alarm.hard.projected,
          topSource: top,
        });
        safeToast({ title: "Context Growth ⚠️", message, variant: "error" });
      }
      return;
    }

    if (alarm.soft) {
      const key = `${sessionID}:slope:soft`;
      if (shouldWarn(key)) {
        const message = `context growing ${formatSlope(alarm.soft.slope)}`;
        logDebugEvent("growth.soft_alarm", {
          agent: agentLabel,
          sessionID,
          slope: alarm.soft.slope,
          growthPctObserved: alarm.soft.growthPctObserved,
        });
        safeToast({ title: "Context Growth ⚠️", message, variant: "warning" });
      }
    }
  }

  /**
   * Adopt a newly seen session for the token meter. A new session (no metrics
   * yet) wins; a session whose tokens we already track does not steal focus
   * (compaction can create a new ID while the metrics belong to the old one).
   */
  function trackSession(sessionID: string): void {
    if (!sessionID || sessionID === currentSessionID) return;
    // An empty currentSessionID is uninitialized, not "no focus": adopt the
    // first session even when its first event already contains tokens.
    if (currentSessionID === "") {
      currentSessionID = sessionID;
      return;
    }
    const m = metrics.get(sessionID);
    const untouched =
      m.contextEstimate === 0 &&
      m.contextUsage === 0 &&
      m.cumulativeUsage === 0;
    if (untouched) currentSessionID = sessionID;
  }

  if (!config.enabled) {
    return {};
  }

  return {
    // ── Pre-request enforcement ─────────────────────────────────────────────
    // `chat.message` is awaited by opencode before the request is sent, so a
    // thrown TokenBudgetExceededError actually blocks the request. The `event`
    // hook is fire-and-forget at the opencode level and must never be relied on
    // for enforcement.
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID;
      const agent =
        input.agent && input.agent.trim().length > 0 ? input.agent : null;

      try {
        // Measure the request that is about to be sent as well: the incoming
        // user parts are not in the event history yet, so include them in the
        // basis (they are not persisted here — later events replace them by id).
        const incoming = (output?.parts ?? []).reduce(
          (sum, part) => sum + (part.type === "text" ? estimateTokens(part.text) : 0),
          0,
        );
        const basis = budgetBasis(metrics.get(sessionID)) + incoming;

        if (basis >= config.softLimit) {
          const isHard = basis >= config.hardLimit;
          const level = isHard ? "HARD" : "SOFT";

          if (shouldWarn(`${sessionID}:limit:${level}`)) {
            safeToast({
              title: "Token Budget ⚠️",
              message: `${level} limit: ${basis} tokens (soft=${config.softLimit}, hard=${config.hardLimit})`,
              variant: isHard ? "error" : "warning",
            });
          }

          logDebugEvent("limit.exceeded", {
            limitType: isHard ? "hard" : "soft",
            sessionID,
            budgetBasis: basis,
            softLimit: config.softLimit,
            hardLimit: config.hardLimit,
            action: isHard ? "throw" : "return",
          });

          await maybeWriteDiary(
            "limit_exceeded",
            sessionID,
            "pre-request",
            basis,
            isHard,
          );

          if (isHard) {
            throw new TokenBudgetExceededError(sessionID, basis, config.hardLimit);
          }
        }

        // Policy-Loop (pre-request, so `enforce` actually blocks).
        const pCtx: PolicyContext = { sessionID, cumulative: basis };
        const policyResults = await runPolicyLoop(policies, pCtx, policyConfig);

        for (const result of policyResults) {
          if (result.level === "enforce") {
            await maybeWriteDiary("policy_enforce", sessionID, "pre-request", basis, true);
            const policyLimit = result.limit ?? config.hardLimit;
            logDebugEvent("policy.enforce", {
              policyName: result.name,
              message: result.message,
              sessionID,
              budgetBasis: basis,
              softLimit: config.softLimit,
              hardLimit: policyLimit,
              action: "throw",
            });
            throw new TokenBudgetExceededError(
              sessionID,
              basis,
              policyLimit,
              `policy "${result.name}" limit`,
            );
          }
          if (result.level === "warn" && shouldWarn(`${sessionID}:policy:${result.name}`)) {
            safeToast({
              title: `Policy: ${result.name}`,
              message: result.message,
              variant: "warning",
            });
            logDebugEvent("policy.warn", {
              policyName: result.name,
              message: result.message,
              tokens: result.tokens,
              limit: result.limit,
              sessionID,
              budgetBasis: basis,
              action: "warn",
            });
          }
        }

        // Turn boundary: finalize the previous turn's budget basis into the
        // slope history, record the new agent, and run the slope alarm.
        const previousAgent = turnTracker.beginTurn(sessionID, agent, basis);
        checkSlopeAlarm(sessionID, previousAgent);
        trackSession(sessionID);

        await maybeWriteDiary("turn", sessionID, "pre-request", basis);

        logDebugEvent("limit.below", {
          sessionID,
          budgetBasis: basis,
          softLimit: config.softLimit,
          hardLimit: config.hardLimit,
          action: "continue",
        });
      } catch (err) {
        // Enforcement must never be swallowed: rethrow the limit error so the
        // awaited hook fails and the request is blocked. Anything else is
        // logged instead of silently discarded.
        if (err instanceof TokenBudgetExceededError) throw err;
        logDebugEvent("hook.error", {
          hook: "chat.message",
          sessionID,
          error: String(err),
        });
      }
    },

    // ── Measurement only (fire-and-forget at the opencode level) ────────────
    event: async (input) => {
      try {
        const ev = input.event as unknown as {
          type?: string;
          properties?: Record<string, unknown>;
        };
        const type = ev.type;
        const props = ev.properties ?? {};

        if (type === "message.part.delta") {
          const sessionID =
            typeof props.sessionID === "string" ? props.sessionID : "";
          const partID =
            typeof props.partID === "string" ? props.partID : "unknown";
          const delta = props.delta;
          if (!sessionID || props.field !== "text" || typeof delta !== "string") {
            return;
          }

          const tokens = estimateTokens(delta);
          // Adopt the session before its metrics are written, so the
          // "untouched" check can still succeed on the first event.
          trackSession(sessionID);
          metrics.onTextDelta(sessionID, partID, delta);

          const turnTokens = turnTracker.addTokens(sessionID, tokens);
          checkPerTurnThreshold(sessionID, turnTokens);

          busPublisher
            .publish(sessionID, metrics.get(sessionID), config)
            .catch(() => {});
          return;
        }

        if (type === "message.part.updated") {
          const part = props.part as
            | {
                id?: string;
                sessionID?: string;
                type?: string;
                text?: string;
                tokens?: UsageTokens;
              }
            | undefined;
          if (!part) return;
          const sessionID =
            typeof part.sessionID === "string"
              ? part.sessionID
              : typeof props.sessionID === "string"
                ? props.sessionID
                : "";
          if (!sessionID) return;
          trackSession(sessionID);

          if (part.type === "text" && typeof part.text === "string") {
            // Full accumulated text: replaces the part's contribution.
            metrics.onTextPartUpdated(sessionID, part.id ?? "unknown", part.text);
            busPublisher
              .publish(sessionID, metrics.get(sessionID), config)
              .catch(() => {});
          } else if (part.type === "step-finish" && part.tokens) {
            const partID = part.id ?? `${sessionID}-step`;
            if (metrics.onStepFinish(sessionID, partID, part.tokens)) {
              busPublisher
                .publish(sessionID, metrics.get(sessionID), config)
                .catch(() => {});
            }
          }
          return;
        }

        if (type === "message.updated") {
          const info = props.info as
            | { role?: string; sessionID?: string; tokens?: UsageTokens }
            | undefined;
          if (
            !info ||
            info.role !== "assistant" ||
            typeof info.sessionID !== "string" ||
            !info.tokens
          ) {
            return;
          }
          trackSession(info.sessionID);
          metrics.onAssistantMessage(info.sessionID, info.tokens);
          busPublisher
            .publish(info.sessionID, metrics.get(info.sessionID), config)
            .catch(() => {});
        }
      } catch (err) {
        logDebugEvent("hook.error", {
          hook: "event",
          error: String(err),
        });
      }
    },

    tool: {
      token_meter_status: createTokenMeterTool(
        metrics,
        config,
        () => currentSessionID,
      ),
    },
  };
};

export default FourTokenBudgetGuardPlugin;
