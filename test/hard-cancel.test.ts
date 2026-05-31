import { describe, it, expect } from "bun:test";
import { TokenBudgetExceededError } from "../src/errors";

describe("TokenBudgetExceededError", () => {
  it("has correct message and properties", () => {
    const err = new TokenBudgetExceededError("ses_abc", 150_000, 100_000);
    expect(err.name).toBe("TokenBudgetExceededError");
    expect(err.sessionID).toBe("ses_abc");
    expect(err.cumulative).toBe(150_000);
    expect(err.hardLimit).toBe(100_000);
    expect(err.message).toContain("HARD limit exceeded");
    expect(err.message).toContain("ses_abc");
    expect(err.message).toContain("150000");
  });

  it("is instanceof Error", () => {
    const err = new TokenBudgetExceededError("s", 1, 0);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof TokenBudgetExceededError).toBe(true);
  });
});
