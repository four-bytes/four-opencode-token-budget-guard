import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Best-effort cross-plugin read of the context-curator compaction diary, to name
 * the top pruned source in the growth hard warning. Never throws — returns null
 * on any failure (missing/unparseable diary).
 */

export interface CuratorDiaryEntry {
  tool?: string;
  linesBefore?: number;
  linesAfter?: number;
  [key: string]: unknown;
}

export interface TopSource {
  tool: string;
  /** Percentage of total pruned lines attributable to this tool. */
  pct: number;
}

const DEFAULT_CACHE_DIR = join(
  homedir(),
  ".cache",
  "opencode",
  "four-opencode-context-curator",
);

/** Parse a JSONL string into diary entries, skipping malformed lines. */
export function parseCuratorJsonl(raw: string): CuratorDiaryEntry[] {
  const entries: CuratorDiaryEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as CuratorDiaryEntry);
    } catch {
      // skip malformed line
    }
  }
  return entries;
}

/**
 * Aggregate pruned lines (`linesBefore - linesAfter`, only >0) by tool and
 * return the top tool + its share of total pruned lines. Returns null when there
 * is nothing pruned.
 */
export function aggregateTopSource(
  entries: CuratorDiaryEntry[],
): TopSource | null {
  const byTool = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    const pruned = Math.max(0, (e.linesBefore ?? 0) - (e.linesAfter ?? 0));
    if (pruned <= 0) continue;
    total += pruned;
    const tool = e.tool && e.tool.trim().length > 0 ? e.tool : "other";
    byTool.set(tool, (byTool.get(tool) ?? 0) + pruned);
  }

  if (total <= 0) return null;

  let topTool = "";
  let topVal = 0;
  for (const [tool, v] of byTool) {
    if (v > topVal) {
      topVal = v;
      topTool = tool;
    }
  }
  if (!topTool) return null;

  return { tool: topTool, pct: Math.round((topVal / total) * 100) };
}

/**
 * Read the top pruned source for a session from the context-curator diary.
 * Accepts a cacheDir override for testing. Never throws — returns null on any
 * failure.
 */
export function readTopSource(
  sessionId: string,
  cacheDir: string = DEFAULT_CACHE_DIR,
): TopSource | null {
  try {
    if (!existsSync(cacheDir)) return null;
    const files = readdirSync(cacheDir).filter(
      (f) => f.startsWith(`compaction-events-${sessionId}-`) && f.endsWith(".jsonl"),
    );
    if (files.length === 0) return null;

    const entries: CuratorDiaryEntry[] = [];
    for (const file of files) {
      let raw: string;
      try {
        raw = readFileSync(join(cacheDir, file), "utf-8");
      } catch {
        continue;
      }
      entries.push(...parseCuratorJsonl(raw));
    }
    return aggregateTopSource(entries);
  } catch {
    return null;
  }
}
