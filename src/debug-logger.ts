import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DebugEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "opencode", "four-opencode-token-budget-guard");
}

function getLogPath(): string {
  const date = new Date().toISOString().split("T")[0];
  return join(cacheDir(), `debug-${date}.jsonl`);
}

function ensureDir(): void {
  const dir = cacheDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Writes a JSON debug event to a daily JSONL file.
 * No-op unless CC_DEBUG === "true". Never throws.
 */
export function logDebugEvent(
  type: string,
  payload: Record<string, unknown>,
): void {
  if (process.env.CC_DEBUG !== "true") return;

  try {
    ensureDir();
    const event: DebugEvent = { ts: Date.now(), type, ...payload };
    const line = JSON.stringify(event) + "\n";
    appendFileSync(getLogPath(), line, "utf-8");
  } catch {
    // Silent — never throw from debug logger
  }
}
