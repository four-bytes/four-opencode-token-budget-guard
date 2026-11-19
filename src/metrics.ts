/**
 * Token measurement for a session.
 *
 * opencode emits two very different text events and one authoritative usage
 * event:
 * - `message.part.updated` carries the FULL accumulated `part.text` (and is
 *   re-emitted on every text-end/plugin rewrite). Summing it per event counts
 *   the same text again and again.
 * - `message.part.delta` carries only the new chunk (`field === "text"`), so it
 *   is safe to accumulate per event.
 * - `message.part.updated` with `part.type === "step-finish"` (and
 *   `message.updated` for assistant messages) carries the provider's real
 *   `tokens` object.
 *
 * This tracker keeps those values distinct and never double-counts:
 * - `contextEstimate`   — chars/4 estimate of the current part texts, keyed by
 *                         part id so a full-text update REPLACES the old value.
 *                         Raw character counts are stored per part and the
 *                         token estimate is derived from that total, so
 *                         per-chunk rounding cannot inflate it.
 * - `generatedEstimate` — chars/4 estimate of assistant text deltas (monotonic,
 *                         derived from the accumulated raw character count).
 * - `cumulativeUsage`   — authoritative token total summed over completed steps
 *                         (deduplicated by step-finish part id).
 * - `cacheRead/Write`   — authoritative cache metrics from the latest usage.
 * - `contextUsage`      — authoritative size of the latest request context
 *                         (prompt/input tokens only — which already include
 *                         cached reads/writes), 0 until known.
 */

export interface UsageTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: {
    read?: number;
    write?: number;
  };
}

export interface SessionMetrics {
  /** chars/4 estimate of the current conversation text parts. */
  contextEstimate: number;
  /** chars/4 estimate of assistant text deltas generated in this session. */
  generatedEstimate: number;
  /** Authoritative cumulative usage summed over completed steps. */
  cumulativeUsage: number;
  /** Authoritative cache read tokens from the latest usage report. */
  cacheRead: number;
  /** Authoritative cache write tokens from the latest usage report. */
  cacheWrite: number;
  /** Authoritative current context size (input/prompt tokens) from the latest usage report (0 = unknown). */
  contextUsage: number;
}

/** Default cap on tracked sessions before LRU eviction kicks in. */
export const DEFAULT_MAX_SESSIONS = 1_000;
/** Default idle time after which a session's metrics are dropped. */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const EMPTY_METRICS: SessionMetrics = {
  contextEstimate: 0,
  generatedEstimate: 0,
  cumulativeUsage: 0,
  cacheRead: 0,
  cacheWrite: 0,
  contextUsage: 0,
};

function safe(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

/** chars/4 heuristic on a character count (no string allocation). */
function estimateChars(chars: number): number {
  return chars <= 0 ? 0 : Math.ceil(chars / 4);
}

/**
 * Total token activity of a usage report: input + output + reasoning +
 * cache read/write. Mirrors opencode's `TokenUsage.total`. This is NOT the
 * context size — the context window fills from `input` alone (which already
 * includes cached reads/writes), so budget checks must use `input`, not this.
 */
export function totalTokens(tokens: UsageTokens | undefined): number {
  if (!tokens) return 0;
  return (
    safe(tokens.input) +
    safe(tokens.output) +
    safe(tokens.reasoning) +
    safe(tokens.cache?.read) +
    safe(tokens.cache?.write)
  );
}

/**
 * Value the budget guard enforces against. The authoritative `contextUsage` is
 * preferred; the text estimate is only the fallback before the first usage
 * report arrives.
 */
export function budgetBasis(metrics: SessionMetrics): number {
  return metrics.contextUsage > 0
    ? metrics.contextUsage
    : metrics.contextEstimate;
}

export class MetricsTracker {
  private metrics = new Map<string, SessionMetrics>();
  /** sessionID → partID → raw character count (so an update replaces, not adds). */
  private partChars = new Map<string, Map<string, number>>();
  /** sessionID → raw characters generated via text deltas (monotonic). */
  private generatedChars = new Map<string, number>();
  /** sessionID → step-finish part ids already counted. */
  private seenSteps = new Map<string, Set<string>>();
  /** sessionID → last write timestamp, for TTL eviction. */
  private lastAccess = new Map<string, number>();
  /** sessionID → recency order (Map insertion order, most recent last). */
  private accessOrder = new Map<string, true>();

  constructor(
    private readonly maxSessions = DEFAULT_MAX_SESSIONS,
    private readonly ttlMs = DEFAULT_SESSION_TTL_MS,
  ) {}

  private deleteSession(sessionID: string): void {
    this.metrics.delete(sessionID);
    this.partChars.delete(sessionID);
    this.generatedChars.delete(sessionID);
    this.seenSteps.delete(sessionID);
    this.lastAccess.delete(sessionID);
    this.accessOrder.delete(sessionID);
  }

  /** True when the session's last write is older than the configured TTL. */
  private expired(sessionID: string): boolean {
    const ts = this.lastAccess.get(sessionID);
    return ts !== undefined && Date.now() - ts > this.ttlMs;
  }

  private evict(): void {
    const now = Date.now();
    for (const [id, ts] of this.lastAccess) {
      if (now - ts > this.ttlMs) this.deleteSession(id);
    }
    while (this.metrics.size >= this.maxSessions) {
      const oldestID = this.accessOrder.keys().next().value;
      if (oldestID === undefined) break;
      this.deleteSession(oldestID);
    }
  }

  private state(sessionID: string): SessionMetrics {
    let s = this.metrics.get(sessionID);
    // Stale metrics must never be reused: an expired entry is dropped and
    // recreated so old usage cannot keep blocking requests.
    if (s && this.expired(sessionID)) {
      this.deleteSession(sessionID);
      s = undefined;
    }
    if (!s) {
      // Only evict when a genuinely new session is added, so updating a known
      // session can never evict its own accumulated metrics.
      this.evict();
      s = { ...EMPTY_METRICS };
      this.metrics.set(sessionID, s);
    }
    this.lastAccess.set(sessionID, Date.now());
    // Re-insert to move this session to the most-recent end of the LRU order.
    this.accessOrder.delete(sessionID);
    this.accessOrder.set(sessionID, true);
    return s;
  }

  private parts(sessionID: string): Map<string, number> {
    let p = this.partChars.get(sessionID);
    if (!p) {
      p = new Map();
      this.partChars.set(sessionID, p);
    }
    return p;
  }

  get(sessionID: string): SessionMetrics {
    // TTL applies on read too: a stale session must not report old usage.
    if (this.expired(sessionID)) this.deleteSession(sessionID);
    return { ...(this.metrics.get(sessionID) ?? EMPTY_METRICS) };
  }

  /**
   * Drop all tracked state for a session. Used after compaction or a new
   * session so stale usage cannot keep firing the budget gate.
   */
  reset(sessionID: string): void {
    this.deleteSession(sessionID);
  }

  /** A streamed text chunk (`message.part.delta`). Added exactly once. */
  onTextDelta(sessionID: string, partID: string, delta: string): void {
    if (delta.length === 0) return;
    // Touch state first: it may drop an expired session (including the old
    // per-part counters) before this delta is applied.
    const s = this.state(sessionID);
    const parts = this.parts(sessionID);
    const previousChars = parts.get(partID) ?? 0;
    const nextChars = previousChars + delta.length;
    parts.set(partID, nextChars);

    // Derive both estimates from the raw character totals so five 1-char
    // deltas cost ceil(5/4) = 2 tokens, not 5.
    s.contextEstimate = Math.max(
      0,
      s.contextEstimate + estimateChars(nextChars) - estimateChars(previousChars),
    );
    const generated = (this.generatedChars.get(sessionID) ?? 0) + delta.length;
    this.generatedChars.set(sessionID, generated);
    s.generatedEstimate = estimateChars(generated);
  }

  /**
   * A full text part (`message.part.updated`). The event carries the complete
   * accumulated text, so the part's contribution is REPLACED — never added.
   */
  onTextPartUpdated(sessionID: string, partID: string, text: string): void {
    // Touch state first: it may drop an expired session (including the old
    // per-part counters) before this full-text update is applied.
    const s = this.state(sessionID);
    const parts = this.parts(sessionID);
    const previousChars = parts.get(partID) ?? 0;
    const nextChars = text.length;
    parts.set(partID, nextChars);
    s.contextEstimate = Math.max(
      0,
      s.contextEstimate + estimateChars(nextChars) - estimateChars(previousChars),
    );
  }

  /**
   * Authoritative per-step usage (`message.part.updated` with
   * `part.type === "step-finish"`). Deduplicated by part id; returns whether
   * this call counted a new step.
   */
  onStepFinish(
    sessionID: string,
    stepID: string,
    tokens: UsageTokens | undefined,
  ): boolean {
    let seen = this.seenSteps.get(sessionID);
    if (!seen) {
      seen = new Set();
      this.seenSteps.set(sessionID, seen);
    }
    if (seen.has(stepID)) return false;
    seen.add(stepID);

    const total = totalTokens(tokens);
    const s = this.state(sessionID);
    s.cumulativeUsage += total;
    s.cacheRead = safe(tokens?.cache?.read);
    s.cacheWrite = safe(tokens?.cache?.write);
    // Context size = prompt/input tokens only: output/reasoning are generated,
    // and cache read/write are already included in `input`.
    const input = safe(tokens?.input);
    if (input > 0) s.contextUsage = input;
    return true;
  }

  /**
   * Authoritative assistant message usage (`message.updated`). Sets the current
   * context size and cache metrics; never adds to `cumulativeUsage` (that is
   * the per-step accumulator's job, to avoid counting the same step twice).
   */
  onAssistantMessage(sessionID: string, tokens: UsageTokens | undefined): void {
    if (!tokens) return;
    const s = this.state(sessionID);
    s.cacheRead = safe(tokens.cache?.read);
    s.cacheWrite = safe(tokens.cache?.write);
    const input = safe(tokens.input);
    if (input > 0) s.contextUsage = input;
  }
}
