import { describe, it, expect } from "bun:test";
import { shouldTriggerCompaction } from "../src/compaction-trigger";

describe("shouldTriggerCompaction", () => {
  it("does not trigger below the threshold", () => {
    // 80% of 200_000 = 160_000
    expect(
      shouldTriggerCompaction(159_999, 200_000, 80, undefined, 60_000),
    ).toBe(false);
  });

  it("triggers at the threshold when there was no previous trigger", () => {
    expect(
      shouldTriggerCompaction(160_000, 200_000, 80, undefined, 60_000),
    ).toBe(true);
  });

  it("does not trigger again inside the cooldown window", () => {
    const now = 1_000_000;
    expect(
      shouldTriggerCompaction(160_000, 200_000, 80, now - 59_999, 60_000, now),
    ).toBe(false);
  });

  it("triggers again once the cooldown has elapsed", () => {
    const now = 1_000_000;
    expect(
      shouldTriggerCompaction(160_000, 200_000, 80, now - 60_000, 60_000, now),
    ).toBe(true);
  });
});
