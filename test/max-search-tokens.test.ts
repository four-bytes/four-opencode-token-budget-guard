import { describe, it, expect } from "bun:test";
import { MaxSearchResultTokensPolicy } from "../src/policies/max-search-tokens";

describe("MaxSearchResultTokensPolicy", () => {
  it("returns null when message has few lines", async () => {
    const policy = new MaxSearchResultTokensPolicy();
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        parts: [{ text: "Short message with just a few lines" }],
      },
    });
    expect(result).toBeNull();
  });

  it("returns warn when message exceeds 50 lines", async () => {
    const policy = new MaxSearchResultTokensPolicy();
    const longText = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        parts: [{ text: longText }],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("max_search_result_tokens");
    expect(result!.level).toBe("warn");
  });

  it("returns enforce when message exceeds 200 lines", async () => {
    const policy = new MaxSearchResultTokensPolicy();
    const veryLongText = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        parts: [{ text: veryLongText }],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("max_search_result_tokens");
    expect(result!.level).toBe("enforce");
  });

  it("returns null when no parts in message", async () => {
    const policy = new MaxSearchResultTokensPolicy();
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {},
    });
    expect(result).toBeNull();
  });
});
