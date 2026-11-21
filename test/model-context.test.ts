import { describe, it, expect } from "bun:test";
import {
  effectiveLimits,
  resolveModelContextLimit,
  type ModelProviderInfo,
} from "../src/model-context";

const providers: ModelProviderInfo[] = [
  {
    id: "anthropic",
    models: {
      "claude-sonnet-4": { limit: { context: 200_000 } },
      "claude-no-limit": {},
      "claude-zero-limit": { limit: { context: 0 } },
    },
  },
  { id: "no-models" },
];

describe("resolveModelContextLimit", () => {
  it("returns the context window of a known provider/model", () => {
    expect(
      resolveModelContextLimit(providers, "anthropic", "claude-sonnet-4"),
    ).toBe(200_000);
  });

  it("returns null for an unknown provider", () => {
    expect(
      resolveModelContextLimit(providers, "openai", "claude-sonnet-4"),
    ).toBeNull();
  });

  it("returns null for an unknown model", () => {
    expect(resolveModelContextLimit(providers, "anthropic", "gpt-x")).toBeNull();
  });

  it("returns null when the model has no context limit", () => {
    expect(
      resolveModelContextLimit(providers, "anthropic", "claude-no-limit"),
    ).toBeNull();
  });

  it("returns null when the context limit is zero", () => {
    expect(
      resolveModelContextLimit(providers, "anthropic", "claude-zero-limit"),
    ).toBeNull();
  });

  it("returns null when the provider declares no models", () => {
    expect(resolveModelContextLimit(providers, "no-models", "any")).toBeNull();
  });
});

describe("effectiveLimits", () => {
  it("keeps the configured limits when the model context is unknown", () => {
    expect(effectiveLimits(100_000, 200_000, 10, null)).toEqual({
      softLimit: 100_000,
      hardLimit: 200_000,
    });
  });

  it("keeps the configured hard limit when the model window is larger", () => {
    const limits = effectiveLimits(100_000, 200_000, 10, 1_000_000);
    expect(limits.hardLimit).toBe(200_000);
    expect(limits.softLimit).toBe(100_000);
  });

  it("clamps the hard limit to the model window minus the margin", () => {
    const limits = effectiveLimits(100_000, 200_000, 10, 128_000);
    expect(limits.hardLimit).toBe(Math.floor((128_000 * 90) / 100));
    expect(limits.softLimit).toBe(100_000);
  });

  it("clamps the soft limit down to the clamped hard limit", () => {
    const limits = effectiveLimits(150_000, 200_000, 10, 128_000);
    expect(limits.hardLimit).toBe(Math.floor((128_000 * 90) / 100));
    expect(limits.softLimit).toBe(limits.hardLimit);
  });

  it("treats a margin of 0 as no reserved headroom", () => {
    expect(effectiveLimits(10, 1_000, 0, 500).hardLimit).toBe(500);
  });
});
