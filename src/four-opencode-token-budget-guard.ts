import type { Plugin } from "@opencode-ai/plugin";
import { envInt, loadConfig } from "./config.js";
import { effectiveLimits, resolveModelContextLimit } from "./model-context.js";
import { writeDiaryEntry } from "./diary.js";
import { estimateTokens } from "./tokens.js";
import {
  shouldTriggerCompaction,
  withTimeout,
} from "./compaction-trigger.js";
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

// Resolved model context windows, keyed by `providerID/modelID` (`null` when
// the provider/model is unknown or the lookup failed).
const modelContextCache = new Map<string, number | null>();

// Last native-compaction trigger per session (epoch ms). Also doubles as the
// in-flight guard: set synchronously before the summarize call so a
// re-entrant request cannot start a second summarize.
const lastCompactionTs = new Map<string, number>();

// Session → is-child flag. `parentID` never changes for a session, so the
// lookup is cached per session.
const childSessionCache = new Map<string, boolean>();

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
      // showToast returns a promise and may reject asynchronously; surface that
      // in the debug log instead of swallowing it, so a broken toast is visible.
      void Promise.resolve(
        ctx.client.tui.showToast({ body: { ...body, duration: body.duration ?? 7000 } }),
      ).catch((e) => {
        logDebugEvent("toast.failed", { error: String(e) });
      });
    } catch (e) {
      // Never let a UI failure break measurement or enforcement, but log it.
      logDebugEvent("toast.failed", { error: String(e) });
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
        const message = `context growing ${formatSlope(alarm.hard.slope)}`;
        logDebugEvent("growth.hard_alarm", {
          agent: agentLabel,
          sessionID,
          slope: alarm.hard.slope,
          projected: alarm.hard.projected,
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

  /** Context window of the model handling the request, cached per model. */
  async function resolveModelContext(
    providerID: string,
    modelID: string,
  ): Promise<number | null> {
    const key = `${providerID}/${modelID}`;
    if (modelContextCache.has(key)) return modelContextCache.get(key)!;
    try {
      const res = await ctx.client.config.providers();
      const providers = res.data?.providers ?? [];
      const ctxLimit = resolveModelContextLimit(providers, providerID, modelID);
      modelContextCache.set(key, ctxLimit);
      return ctxLimit;
    } catch (err) {
      logDebugEvent("model_context.lookup_failed", {
        providerID,
        modelID,
        error: String(err),
      });
      modelContextCache.set(key, null);
      return null;
    }
  }

  /**
   * True for child/subagent sessions (non-empty `parentID`). Native summarize
   * kills a child session, so compaction may only run for a root session.
   * Unresolvable sessions fall back to root behaviour and are not cached.
   */
  async function isChildSession(sessionID: string): Promise<boolean> {
    if (!sessionID || sessionID === "unknown" || sessionID === "default") {
      return false;
    }
    const cached = childSessionCache.get(sessionID);
    if (cached !== undefined) return cached;
    try {
      const res = await ctx.client.session.get({
        path: { id: sessionID },
        query: { directory: process.cwd() },
        throwOnError: true,
      });
      const parentID = (res as { data?: { parentID?: string | null } }).data
        ?.parentID;
      const isChild = typeof parentID === "string" && parentID.length > 0;
      childSessionCache.set(sessionID, isChild);
      return isChild;
    } catch (err) {
      // Unknown target → preserve root behaviour rather than block. Not cached,
      // so a later lookup can still succeed.
      logDebugEvent("compaction.parent_lookup_error", {
        sessionID,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Trigger opencode's native session compaction (same as the /compact command).
   * Fire-and-forget from the caller's perspective: it never throws and the
   * current request continues normally — the compaction acts on later turns.
   */
  async function triggerNativeCompaction(
    sessionID: string,
    providerID: string,
    modelID: string,
  ): Promise<void> {
    // Set synchronously before any await: the summarizer's own request
    // re-enters chat.message while this promise is pending. Marking it here
    // blocks a second summarize (reentrancy) and starts the cooldown, which is
    // also kept on failure so a broken summarize cannot retry-storm.
    lastCompactionTs.set(sessionID, Date.now());

    if (await isChildSession(sessionID)) {
      logDebugEvent("compaction.skipped_child", { sessionID });
      return;
    }

    try {
      logDebugEvent("compaction.triggered", { sessionID, providerID, modelID });
      await withTimeout(
        ctx.client.session.summarize({
          path: { id: sessionID },
          query: { directory: process.cwd() },
          body: { providerID, modelID },
          throwOnError: true,
        }),
        config.compactTimeoutMs,
        "native session.summarize()",
      );
    } catch (err) {
      logDebugEvent("compaction.error", { sessionID, error: String(err) });
    }
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

        const modelContext = input.model
          ? await resolveModelContext(input.model.providerID, input.model.modelID)
          : null;
        const limits = effectiveLimits(
          config.softLimit,
          config.hardLimit,
          config.modelMarginPct,
          modelContext,
        );

        // Native compaction step between soft warning and hard block: once the
        // basis reaches `compactPct` of the effective hard limit, hand the turn
        // to opencode's own summarize (fire-and-forget). It acts on FOLLOWING
        // turns, so the current request proceeds normally.
        const compactThreshold = Math.floor(
          (limits.hardLimit * config.compactPct) / 100,
        );
        if (
          basis >= compactThreshold &&
          basis < limits.hardLimit &&
          input.model?.providerID &&
          input.model?.modelID &&
          shouldTriggerCompaction(
            basis,
            limits.hardLimit,
            config.compactPct,
            lastCompactionTs.get(sessionID),
            config.compactCooldownMs,
          )
        ) {
          void triggerNativeCompaction(
            sessionID,
            input.model.providerID,
            input.model.modelID,
          );
        }

        if (basis >= limits.softLimit) {
          const isHard = basis >= limits.hardLimit;
          const level = isHard ? "HARD" : "SOFT";

          if (shouldWarn(`${sessionID}:limit:${level}`)) {
            // Toast is scheduled before any await so the hard-limit throw can
            // never skip it. HARD is visually distinct and stays up longer.
            const clampedByModel =
              modelContext !== null && limits.hardLimit < config.hardLimit;
            safeToast({
              title: isHard ? "Token Budget — Hard Limit ⛔" : "Token Budget — Soft Limit ⚠️",
              message: isHard
                ? clampedByModel
                  ? `Token budget guard blocked the request: ${basis} tokens exceed the model-aware hard limit of ${limits.hardLimit} (model context ${modelContext}). Compact the session or start a new one.`
                  : `Token budget guard blocked the request: ${basis} tokens exceed the hard limit of ${limits.hardLimit}. Raise FOUR_TBG_HARD_LIMIT or start a new session to continue.`
                : `Approaching the hard limit: ${basis} tokens (soft=${limits.softLimit}, hard=${limits.hardLimit}).`,
              variant: isHard ? "error" : "warning",
              duration: isHard ? 12000 : undefined,
            });
          }

          logDebugEvent("limit.exceeded", {
            limitType: isHard ? "hard" : "soft",
            sessionID,
            budgetBasis: basis,
            softLimit: limits.softLimit,
            hardLimit: limits.hardLimit,
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
            throw new TokenBudgetExceededError(sessionID, basis, limits.hardLimit);
          }
        }

        // Policy-Loop (pre-request, so `enforce` actually blocks).
        const pCtx: PolicyContext = { sessionID, cumulative: basis };
        const policyResults = await runPolicyLoop(policies, pCtx, policyConfig);

        for (const result of policyResults) {
          if (result.level === "enforce") {
            await maybeWriteDiary("policy_enforce", sessionID, "pre-request", basis, true);
            const policyLimit = result.limit ?? limits.hardLimit;
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
          softLimit: limits.softLimit,
          hardLimit: limits.hardLimit,
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

    // ── Compaction reset ────────────────────────────────────────────────────
    // After compaction the context is rebuilt, so stale token counts must not
    // keep the gate firing (which would "kill the context" on the next request).
    "experimental.session.compacting": async (input, output) => {
      try {
        output.context.push(
          "Preserve across compaction: the active task, user instructions, decisions, actionable errors, and the recent 5 turns. Condense completed issues. Truncate long tool logs, never assistant instructions.",
        );
        metrics.reset(input.sessionID);
        turnTracker.reset(input.sessionID);
        if (currentSessionID === input.sessionID) currentSessionID = "";
        logDebugEvent("compaction.reset", { sessionID: input.sessionID });
      } catch (err) {
        logDebugEvent("hook.error", {
          hook: "experimental.session.compacting",
          sessionID: input.sessionID,
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
