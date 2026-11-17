import { describe, it, expect } from "bun:test";
import { loadPolicyConfig, runPolicyLoop, type PolicyContext } from "../src/policy-engine";
import { MaxStartTokensPolicy } from "../src/policies/max-start-tokens";

describe("Policy Engine Integration", () => {
  it("loads default config (all enabled, warn-only)", () => {
    delete process.env.FOUR_TBG_POLICIES;
    const conf = loadPolicyConfig();
    expect(conf.policies).toBeDefined();
  });

  it("runs policy loop with empty policies", async () => {
    const ctx: PolicyContext = { sessionID: "test", cumulative: 100 };
    const results = await runPolicyLoop([], ctx, loadPolicyConfig());
    expect(results).toEqual([]);
  });

  it("max_start_tokens warns when over limit", async () => {
    const policy = new MaxStartTokensPolicy();
    const ctx: PolicyContext = { sessionID: "test", cumulative: 50000 };
    const result = await policy.check(ctx);
    expect(result).not.toBeNull();
    expect(result!.level).toBe("warn");
    expect(result!.message).toContain("exceed start-token limit");
  });

  it("max_start_tokens ok when under limit", async () => {
    const policy = new MaxStartTokensPolicy();
    const ctx: PolicyContext = { sessionID: "test", cumulative: 1000 };
    const result = await policy.check(ctx);
    expect(result).toBeNull();
  });

  it("upgrades a warning to enforce when the policy config says enforce", async () => {
    const ctx: PolicyContext = { sessionID: "test", cumulative: 50000 };
    const results = await runPolicyLoop(
      [new MaxStartTokensPolicy()],
      ctx,
      { policies: { max_start_tokens: { enabled: true, enforce: true } } },
    );
    expect(results).toHaveLength(1);
    expect(results[0].level).toBe("enforce");
  });

  it("keeps warnings non-blocking when enforce is false", async () => {
    const ctx: PolicyContext = { sessionID: "test", cumulative: 50000 };
    const results = await runPolicyLoop(
      [new MaxStartTokensPolicy()],
      ctx,
      { policies: { max_start_tokens: { enabled: true, enforce: false } } },
    );
    expect(results).toHaveLength(1);
    expect(results[0].level).toBe("warn");
  });
});
