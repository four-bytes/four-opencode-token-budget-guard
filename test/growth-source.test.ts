import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateTopSource,
  parseCuratorJsonl,
  readTopSource,
  type CuratorDiaryEntry,
} from "../src/growth-source";

describe("parseCuratorJsonl", () => {
  it("parses lines and skips malformed ones", () => {
    const raw = [
      `{"tool":"run_tests","linesBefore":100,"linesAfter":50}`,
      `not json`,
      ``,
      `{"tool":"read","linesBefore":10,"linesAfter":10}`,
    ].join("\n");
    const entries = parseCuratorJsonl(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0].tool).toBe("run_tests");
  });
});

describe("aggregateTopSource", () => {
  it("returns the top tool and its percentage share", () => {
    const entries: CuratorDiaryEntry[] = [
      { tool: "run_tests", linesBefore: 100, linesAfter: 50 }, // 50 pruned
      { tool: "run_tests", linesBefore: 40, linesAfter: 20 }, // 20 pruned
      { tool: "read", linesBefore: 30, linesAfter: 0 }, // 30 pruned
    ];
    // total pruned = 100; run_tests = 70 → 70%
    expect(aggregateTopSource(entries)).toEqual({ tool: "run_tests", pct: 70 });
  });

  it("ignores non-pruned entries (linesAfter >= linesBefore)", () => {
    const entries: CuratorDiaryEntry[] = [
      { tool: "run_tests", linesBefore: 10, linesAfter: 10 },
      { tool: "run_tests", linesBefore: 5, linesAfter: 20 },
    ];
    expect(aggregateTopSource(entries)).toBeNull();
  });

  it("maps missing tool to 'other'", () => {
    const entries: CuratorDiaryEntry[] = [
      { linesBefore: 100, linesAfter: 50 },
    ];
    expect(aggregateTopSource(entries)).toEqual({ tool: "other", pct: 100 });
  });

  it("returns null for empty input", () => {
    expect(aggregateTopSource([])).toBeNull();
  });
});

describe("readTopSource", () => {
  it("reads and aggregates from fixture JSONL files", () => {
    const dir = mkdtempSync(join(tmpdir(), "tbg-growth-source-"));
    try {
      writeFileSync(
        join(dir, "compaction-events-ses_1-2026-09-23.jsonl"),
        [
          `{"tool":"run_tests","linesBefore":100,"linesAfter":50}`,
          `{"tool":"read","linesBefore":30,"linesAfter":0}`,
        ].join("\n"),
      );
      expect(readTopSource("ses_1", dir)).toEqual({ tool: "run_tests", pct: 63 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when no diary files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "tbg-growth-source-"));
    try {
      expect(readTopSource("ses_missing", dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when the directory does not exist", () => {
    expect(readTopSource("ses_1", "/definitely/not/a/real/dir")).toBeNull();
  });
});
