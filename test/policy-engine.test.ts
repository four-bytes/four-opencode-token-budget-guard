import { describe, it, expect } from "bun:test";
import { loadPolicyConfig, runPolicyLoop, type Policy, type PolicyContext } from "../src/policy-engine";
import { MaxStartTokensPolicy } from "../src/policies/max-start-tokens";
import { MaxPlannerTokensPolicy } from "../src/policies/max-planner-tokens";
import { MaxSearchResultTokensPolicy } from "../src/policies/max-search-tokens";
import { GrepModePolicy } from "../src/policies/grep-mode";

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

  it("max_planner_tokens detects long assistant messages", async () => {
    process.env.FOUR_TBG_MAX_PLANNER_TOKENS = "50";
    const policy = new MaxPlannerTokensPolicy();
    const ctx: PolicyContext = {
      sessionID: "test",
      cumulative: 0,
      message: {
        info: { role: "assistant" },
        parts: [{ text: "x".repeat(500) }],
      },
    };
    const result = await policy.check(ctx);
    expect(result).not.toBeNull();
    delete process.env.FOUR_TBG_MAX_PLANNER_TOKENS;
  });

  it("max_planner_tokens skips non-assistant", async () => {
    const policy = new MaxPlannerTokensPolicy();
    const ctx: PolicyContext = {
      sessionID: "test",
      cumulative: 0,
      message: {
        info: { role: "user" },
        parts: [{ text: "x".repeat(5000) }],
      },
    };
    const result = await policy.check(ctx);
    expect(result).toBeNull();
  });

  it("max_search_tokens warns on 60+ lines", async () => {
    const policy = new MaxSearchResultTokensPolicy();
    const lines = Array(60).fill("line").join("\n");
    const ctx: PolicyContext = {
      sessionID: "t",
      cumulative: 0,
      message: { parts: [{ text: lines }] },
    };
    const result = await policy.check(ctx);
    expect(result).not.toBeNull();
  });

  it("grep_mode detects grep without --include", async () => {
    const policy = new GrepModePolicy();
    const text = Array(15).fill("grep pattern file").join("\n");
    const ctx: PolicyContext = {
      sessionID: "t",
      cumulative: 0,
      message: { parts: [{ text }] },
    };
    const result = await policy.check(ctx);
    expect(result).not.toBeNull();
  });
});
