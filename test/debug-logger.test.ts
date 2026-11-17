import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Debug Logger", () => {
  const originalDebug = process.env.CC_DEBUG;
  const originalCacheHome = process.env.XDG_CACHE_HOME;
  let logDebugEvent: (type: string, payload: Record<string, unknown>) => void;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "tbg-debug-test-"));
    process.env.XDG_CACHE_HOME = tmpDir;
    const mod = await import("../src/debug-logger");
    logDebugEvent = mod.logDebugEvent;
  });

  afterAll(() => {
    if (originalDebug !== undefined) {
      process.env.CC_DEBUG = originalDebug;
    } else {
      delete process.env.CC_DEBUG;
    }
    if (originalCacheHome !== undefined) {
      process.env.XDG_CACHE_HOME = originalCacheHome;
    } else {
      delete process.env.XDG_CACHE_HOME;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // Reset CC_DEBUG to original between tests
    if (originalDebug !== undefined) {
      process.env.CC_DEBUG = originalDebug;
    } else {
      delete process.env.CC_DEBUG;
    }
  });

  it("is no-op when CC_DEBUG is not set", () => {
    delete process.env.CC_DEBUG;
    logDebugEvent("test.event", { foo: "bar" });

    const cacheDir = join(
      tmpDir,
      "opencode",
      "four-opencode-token-budget-guard",
    );
    expect(existsSync(cacheDir)).toBe(false);
  });

  it("writes JSONL line with correct fields when CC_DEBUG=true", () => {
    process.env.CC_DEBUG = "true";
    const testType = "test.event";
    const testPayload = { foo: "bar", num: 42 };
    logDebugEvent(testType, testPayload);

    const date = new Date().toISOString().split("T")[0];
    const logPath = join(
      tmpDir,
      "opencode",
      "four-opencode-token-budget-guard",
      `debug-${date}.jsonl`,
    );

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8").trim();
    const lines = content.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe(testType);
    expect(parsed.foo).toBe("bar");
    expect(parsed.num).toBe(42);
    expect(typeof parsed.ts).toBe("number");
    expect(parsed.ts).toBeGreaterThan(0);
  });

  it("never throws even with empty payload", () => {
    process.env.CC_DEBUG = "true";
    expect(() => {
      logDebugEvent("test", {});
    }).not.toThrow();
  });
});
