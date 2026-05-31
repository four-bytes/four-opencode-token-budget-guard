import { describe, it, expect } from "bun:test";
import { MaxStartTokensPolicy } from "../src/policies/max-start-tokens";

describe("MaxStartTokensPolicy", () => {
  it("returns null when cumulative is under limit", async () => {
    const policy = new MaxStartTokensPolicy();
    const result = await policy.check({
      sessionID: "test",
      cumulative: 1000,
    });
    expect(result).toBeNull();
  });

  it("returns warn when cumulative exceeds limit", async () => {
    const policy = new MaxStartTokensPolicy();
    const result = await policy.check({
      sessionID: "test",
      cumulative: 50000,
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("max_start_tokens");
    expect(result!.level).toBe("warn");
    expect(result!.tokens).toBe(50000);
  });
});
