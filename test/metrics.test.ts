import { describe, it, expect } from "bun:test";
import {
  MetricsTracker,
  budgetBasis,
  totalTokens,
} from "../src/metrics";

describe("MetricsTracker — accumulated text is not counted twice", () => {
  it("REPLACES a text part's contribution on repeated full-text updates (bug reproduction)", () => {
    const m = new MetricsTracker();
    const session = "s1";
    const partID = "p1";

    // opencode re-emits `message.part.updated` with the FULL accumulated text.
    // Naive summing would give 2 + 4 + 6 = 12; the correct value is 6.
    m.onTextPartUpdated(session, partID, "x".repeat(8)); // 2 tokens
    m.onTextPartUpdated(session, partID, "x".repeat(16)); // 4 tokens
    m.onTextPartUpdated(session, partID, "x".repeat(24)); // 6 tokens

    expect(m.get(session).contextEstimate).toBe(6);
  });

  it("idempotent full-text updates do not change the estimate", () => {
    const m = new MetricsTracker();
    m.onTextPartUpdated("s1", "p1", "abcdefgh");
    m.onTextPartUpdated("s1", "p1", "abcdefgh");
    m.onTextPartUpdated("s1", "p1", "abcdefgh");
    expect(m.get("s1").contextEstimate).toBe(2);
  });

  it("accumulates deltas exactly once and reconciles them with the final full text", () => {
    const m = new MetricsTracker();
    m.onTextDelta("s1", "p1", "abcd"); // 1
    m.onTextDelta("s1", "p1", "efgh"); // 1
    expect(m.get("s1").generatedEstimate).toBe(2);
    expect(m.get("s1").contextEstimate).toBe(2);

    // text-end full text replaces the delta-derived estimate (no double count).
    m.onTextPartUpdated("s1", "p1", "abcdefghijkl"); // 3
    expect(m.get("s1").contextEstimate).toBe(3);
    expect(m.get("s1").generatedEstimate).toBe(2);
  });

  it("keeps parts independent within a session", () => {
    const m = new MetricsTracker();
    m.onTextPartUpdated("s1", "p1", "aaaa"); // 1
    m.onTextPartUpdated("s1", "p2", "bbbb"); // 1
    m.onTextPartUpdated("s1", "p1", "aaaaaaaa"); // p1 -> 2
    expect(m.get("s1").contextEstimate).toBe(3);
  });
});

describe("MetricsTracker — distinct metrics", () => {
  it("reports context estimate, generated estimate, cumulative usage and cache separately", () => {
    const m = new MetricsTracker();
    m.onTextDelta("s1", "p1", "x".repeat(40)); // generated 10, context 10
    m.onStepFinish("s1", "step-1", {
      input: 100,
      output: 20,
      reasoning: 5,
      cache: { read: 30, write: 7 },
    });

    const got = m.get("s1");
    expect(got.contextEstimate).toBe(10);
    expect(got.generatedEstimate).toBe(10);
    expect(got.cumulativeUsage).toBe(162); // 100 + 20 + 5 + 30 + 7
    expect(got.cacheRead).toBe(30);
    expect(got.cacheWrite).toBe(7);
    expect(got.contextUsage).toBe(130); // input (100) + cache.read (30)
  });

  it("deduplicates repeated step-finish updates for the same part id", () => {
    const m = new MetricsTracker();
    const tokens = { input: 100, output: 10, cache: { read: 0, write: 0 } };
    expect(m.onStepFinish("s1", "step-1", tokens)).toBe(true);
    expect(m.onStepFinish("s1", "step-1", tokens)).toBe(false);
    expect(m.get("s1").cumulativeUsage).toBe(110);
  });

  it("sums cumulative usage across steps but only keeps the latest context size", () => {
    const m = new MetricsTracker();
    m.onStepFinish("s1", "step-1", { input: 100, output: 10 });
    m.onStepFinish("s1", "step-2", { input: 150, output: 20 });
    const got = m.get("s1");
    expect(got.cumulativeUsage).toBe(280); // 110 + 170
    expect(got.contextUsage).toBe(150); // latest step's input, not the sum
  });

  it("takes cache metrics and context size from assistant message updates", () => {
    const m = new MetricsTracker();
    m.onAssistantMessage("s1", {
      input: 200,
      output: 30,
      reasoning: 10,
      cache: { read: 50, write: 5 },
    });
    const got = m.get("s1");
    expect(got.contextUsage).toBe(250); // input (200) + cache.read (50)
    expect(got.cacheRead).toBe(50);
    expect(got.cacheWrite).toBe(5);
    expect(got.cumulativeUsage).toBe(0); // never double-counts step usage
  });

  it("prefers authoritative context usage over the text estimate as budget basis", () => {
    const m = new MetricsTracker();
    expect(budgetBasis(m.get("s1"))).toBe(0);

    m.onTextPartUpdated("s1", "p1", "x".repeat(400)); // estimate 100
    expect(budgetBasis(m.get("s1"))).toBe(100);

    m.onStepFinish("s1", "step-1", { input: 500, output: 0 });
    expect(budgetBasis(m.get("s1"))).toBe(500);
  });

  it("totalTokens handles missing and non-finite values safely", () => {
    expect(totalTokens(undefined)).toBe(0);
    expect(totalTokens({})).toBe(0);
    expect(
      totalTokens({
        input: Number.NaN,
        output: -5,
        reasoning: 3,
        cache: { read: 2 },
      }),
    ).toBe(5);
  });

  it("bounds the number of tracked sessions (LRU)", () => {
    const m = new MetricsTracker(2, 60_000);
    m.onTextPartUpdated("s1", "p1", "aaaa");
    m.onTextPartUpdated("s2", "p2", "bbbb");
    // Refresh s1 so s2, not s1, becomes the least-recently-used session.
    m.onTextPartUpdated("s1", "p1", "aaaa");
    m.onTextPartUpdated("s3", "p3", "cccc");

    expect(m.get("s1").contextEstimate).toBe(1); // refreshed, survives
    expect(m.get("s2").contextEstimate).toBe(0); // least recently used
    expect(m.get("s3").contextEstimate).toBe(1);
  });

  it("does not let per-chunk rounding inflate the context estimate", () => {
    // Five 1-char deltas used to cost 5 tokens (ceil per chunk) while the full
    // text costs 2 — the estimate dropped at text-end and pre-request checks
    // fired early. Both must agree now.
    const m = new MetricsTracker();
    for (let i = 0; i < 5; i++) m.onTextDelta("s1", "p1", "x");
    expect(m.get("s1").generatedEstimate).toBe(2);
    expect(m.get("s1").contextEstimate).toBe(2);

    m.onTextPartUpdated("s1", "p1", "xxxxx");
    expect(m.get("s1").contextEstimate).toBe(2); // no drop at text-end
  });

  it("drops an expired session on read", async () => {
    const m = new MetricsTracker(10, 5);
    m.onStepFinish("s1", "step-1", { input: 500 });
    expect(m.get("s1").contextUsage).toBe(500);

    await Bun.sleep(15);
    expect(m.get("s1").contextUsage).toBe(0);
    expect(m.get("s1").cumulativeUsage).toBe(0);
  });

  it("reset clears all tracked metrics for a session", () => {
    const m = new MetricsTracker();
    m.onTextDelta("s1", "p1", "abcdefgh");
    m.onStepFinish("s1", "step-1", { input: 500, output: 100 });
    expect(m.get("s1").contextEstimate).toBeGreaterThan(0);
    expect(m.get("s1").cumulativeUsage).toBeGreaterThan(0);
    expect(m.get("s1").contextUsage).toBe(500);

    m.reset("s1");

    const got = m.get("s1");
    expect(got.contextEstimate).toBe(0);
    expect(got.cumulativeUsage).toBe(0);
    expect(got.contextUsage).toBe(0);
  });

  it("reset only affects the named session", () => {
    const m = new MetricsTracker();
    m.onTextDelta("s1", "p1", "abcdefgh");
    m.onTextDelta("s2", "p1", "abcdefgh");

    m.reset("s1");

    expect(m.get("s1").contextEstimate).toBe(0);
    expect(m.get("s2").contextEstimate).toBeGreaterThan(0);
  });
});
