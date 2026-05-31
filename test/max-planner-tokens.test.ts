import { describe, it, expect } from "bun:test";
import { MaxPlannerTokensPolicy } from "../src/policies/max-planner-tokens";

describe("MaxPlannerTokensPolicy", () => {
  it("returns null when message is not assistant role", async () => {
    const policy = new MaxPlannerTokensPolicy();
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: { info: { role: "user" } },
    });
    expect(result).toBeNull();
  });

  it("returns warn when assistant message exceeds token limit", async () => {
    const policy = new MaxPlannerTokensPolicy();
    // 4000 chars / 4 = 1000 tokens, under default 3000 limit
    // Use 20000 chars / 4 = 5000 tokens to exceed
    const longText = "x".repeat(20000);
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        info: { role: "assistant" },
        parts: [{ text: longText }],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("max_planner_tokens");
    expect(result!.level).toBe("enforce"); // >2000 chars = enforce
    expect(result!.tokens).toBe(5000);
  });

  it("returns null when assistant message is under limit", async () => {
    const policy = new MaxPlannerTokensPolicy();
    const shortText = "x".repeat(400); // 100 tokens, under 3000
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        info: { role: "assistant" },
        parts: [{ text: shortText }],
      },
    });
    expect(result).toBeNull();
  });
});
