import { estimateTokens } from "./tokens.js";

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
 * - `generatedEstimate` — chars/4 estimate of assistant text deltas (monotonic,
 *                         added once per delta).
 * - `cumulativeUsage`   — authoritative token total summed over completed steps
 *                         (deduplicated by step-finish part id).
 * - `cacheRead/Write`   — authoritative cache metrics from the latest usage.
 * - `contextUsage`      — authoritative size of the latest request context
 *                         (input + output + reasoning + cache), 0 until known.
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
  /** Authoritative current context size from the latest usage report (0 = unknown). */
  contextUsage: number;
}

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

/** Total tokens of a usage report: input + output + reasoning + cache read/write. */
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
  /** sessionID → partID → estimated tokens (so an update replaces, not adds). */
  private partTokens = new Map<string, Map<string, number>>();
  /** sessionID → step-finish part ids already counted. */
  private seenSteps = new Map<string, Set<string>>();
  /** sessionID → last write, for TTL/LRU eviction. */
  private lastAccess = new Map<string, number>();

  constructor(
    private readonly maxSessions = 1000,
    private readonly ttlMs = 7 * 24 * 60 * 60 * 1000,
  ) {}

  private deleteSession(sessionID: string): void {
    this.metrics.delete(sessionID);
    this.partTokens.delete(sessionID);
    this.seenSteps.delete(sessionID);
    this.lastAccess.delete(sessionID);
  }

  private evict(): void {
    const now = Date.now();
    for (const [id, ts] of this.lastAccess) {
      if (now - ts > this.ttlMs) this.deleteSession(id);
    }
    while (this.metrics.size >= this.maxSessions) {
      let oldestID: string | null = null;
      let oldest = Infinity;
      for (const [id, ts] of this.lastAccess) {
        if (ts < oldest) {
          oldest = ts;
          oldestID = id;
        }
      }
      if (!oldestID) break;
      this.deleteSession(oldestID);
    }
  }

  private state(sessionID: string): SessionMetrics {
    let s = this.metrics.get(sessionID);
    if (!s) {
      // Only evict when a genuinely new session is added, so updating a known
      // session can never evict its own accumulated metrics.
      this.evict();
      s = { ...EMPTY_METRICS };
      this.metrics.set(sessionID, s);
    }
    this.lastAccess.set(sessionID, Date.now());
    return s;
  }

  private parts(sessionID: string): Map<string, number> {
    let p = this.partTokens.get(sessionID);
    if (!p) {
      p = new Map();
      this.partTokens.set(sessionID, p);
    }
    return p;
  }

  get(sessionID: string): SessionMetrics {
    return { ...(this.metrics.get(sessionID) ?? EMPTY_METRICS) };
  }

  /** A streamed text chunk (`message.part.delta`). Added exactly once. */
  onTextDelta(sessionID: string, partID: string, delta: string): void {
    const tokens = estimateTokens(delta);
    if (tokens === 0) return;
    const s = this.state(sessionID);
    s.generatedEstimate += tokens;
    const parts = this.parts(sessionID);
    parts.set(partID, (parts.get(partID) ?? 0) + tokens);
    s.contextEstimate += tokens;
  }

  /**
   * A full text part (`message.part.updated`). The event carries the complete
   * accumulated text, so the part's contribution is REPLACED — never added.
   */
  onTextPartUpdated(sessionID: string, partID: string, text: string): void {
    const parts = this.parts(sessionID);
    const previous = parts.get(partID) ?? 0;
    const next = estimateTokens(text);
    parts.set(partID, next);
    const s = this.state(sessionID);
    s.contextEstimate = Math.max(0, s.contextEstimate + next - previous);
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
    if (total > 0) s.contextUsage = total;
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
    const total = totalTokens(tokens);
    if (total > 0) s.contextUsage = total;
  }
}
