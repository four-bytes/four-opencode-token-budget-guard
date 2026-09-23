import { describe, it, expect } from "bun:test";
import {
  computeGrowthAlarm,
  formatSlope,
  humanizeTokens,
  linearSlope,
} from "../src/growth";
import { DEFAULT_GROWTH_PARAMS, type GrowthParams } from "../src/agent-config";

/** A linear ramp of cumulative context values. */
function ramp(start: number, step: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + step * i);
}

describe("linearSlope", () => {
  it("computes a positive slope for a linear ramp", () => {
    expect(linearSlope([0, 10, 20, 30])).toBe(10);
  });

  it("returns 0 for a flat series", () => {
    expect(linearSlope([5, 5, 5, 5])).toBe(0);
  });

  it("returns null for fewer than 2 points", () => {
    expect(linearSlope([5])).toBeNull();
    expect(linearSlope([])).toBeNull();
  });
});

describe("formatSlope / humanizeTokens", () => {
  it("formats human-readable slopes", () => {
    expect(humanizeTokens(3100)).toBe("3.1k");
    expect(humanizeTokens(162000)).toBe("162k");
    expect(humanizeTokens(47)).toBe("47");
  });

  it("prefixes positive slopes with +", () => {
    expect(formatSlope(3100)).toBe("+3.1k/turn");
    expect(formatSlope(47)).toBe("+47/turn");
  });
});

describe("computeGrowthAlarm (cumulative series)", () => {
  const params: GrowthParams = { ...DEFAULT_GROWTH_PARAMS };

  it("returns no alarm for a flat cumulative history", () => {
    const history = new Array<number>(10).fill(100_000);
    const r = computeGrowthAlarm(history, params);
    expect(r.soft).toBeNull();
    expect(r.hard).toBeNull();
  });

  it("returns no alarm below the growth window", () => {
    const history = ramp(100_000, 5000, 5); // only 5 turns
    const r = computeGrowthAlarm(history, params);
    expect(r.soft).toBeNull();
    expect(r.hard).toBeNull();
  });

  it("fires soft alarm when cumulative context grows by more than growthPct%", () => {
    // 100k → 127k over 10 turns: +27% growth → soft fires, hard does not.
    const history = ramp(100_000, 3000, 10);
    const r = computeGrowthAlarm(history, params);
    expect(r.soft).not.toBeNull();
    expect(r.soft!.growthPctObserved).toBeGreaterThan(params.growthPct);
    expect(r.hard).toBeNull();
  });

  it("does not fire soft alarm for modest cumulative growth under growthPct%", () => {
    // 100k → 109k over 10 turns: +9% → no soft.
    const history = ramp(100_000, 1000, 10);
    const r = computeGrowthAlarm(history, params);
    expect(r.soft).toBeNull();
  });

  it("fires hard alarm when the cumulative projection reaches the context window", () => {
    // 190k → 199k over 10 turns, slope 1000/turn: 199k + 15k = 214k ≥ 200k.
    const history = ramp(190_000, 1000, 10);
    const r = computeGrowthAlarm(history, params);
    expect(r.hard).not.toBeNull();
    expect(r.hard!.slope).toBe(1000);
    expect(r.hard!.projected).toBeGreaterThanOrEqual(params.contextWindow);
    // relative growth is tiny → soft must NOT fire here
    expect(r.soft).toBeNull();
  });

  it("reports projected tokens correctly", () => {
    const history = ramp(190_000, 1000, 10);
    const r = computeGrowthAlarm(history, params);
    expect(r.hard!.projected).toBe(199_000 + 1000 * params.projectTurns);
  });
});
