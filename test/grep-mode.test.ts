import { describe, it, expect } from "bun:test";
import { GrepModePolicy } from "../src/policies/grep-mode";

describe("GrepModePolicy", () => {
  it("returns null when no grep in message", async () => {
    const policy = new GrepModePolicy();
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        parts: [{ text: "Just a regular message" }],
      },
    });
    expect(result).toBeNull();
  });

  it("returns null when grep has --include flag", async () => {
    const policy = new GrepModePolicy();
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        parts: [{ text: "grep --include='*.ts' pattern src/" }],
      },
    });
    // grep with --include should not trigger
    expect(result).toBeNull();
  });

  it("returns warn when grep without --include and >10 lines", async () => {
    const policy = new GrepModePolicy();
    const text =
      "grep pattern src/\n" + Array.from({ length: 15 }, (_, i) => `match line ${i + 1}`).join("\n");
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        parts: [{ text }],
      },
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("grep_mode");
    expect(result!.level).toBe("warn");
  });

  it("returns null when grep without --include but <=10 lines", async () => {
    const policy = new GrepModePolicy();
    const text = "grep pattern src/\nline 1\nline 2";
    const result = await policy.check({
      sessionID: "test",
      cumulative: 0,
      message: {
        parts: [{ text }],
      },
    });
    expect(result).toBeNull();
  });
});
