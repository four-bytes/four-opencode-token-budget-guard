export interface Config {
  softLimit: number;
  hardLimit: number;
  diaryDir: string;
  enabled: boolean;
  /** Signal curator to compact session when limits are hit */
  compactionTrigger: boolean;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function xdgDataHome(): string {
  return (
    process.env.XDG_DATA_HOME ||
    `${process.env.HOME || ""}/.local/share`
  );
}

export function loadConfig(): Config {
  return {
    softLimit: envInt("FOUR_TBG_SOFT_LIMIT", 50_000),
    hardLimit: envInt("FOUR_TBG_HARD_LIMIT", 100_000),
    diaryDir: `${xdgDataHome()}/four-opencode-token-budget-guard/diary`,
    enabled: process.env.FOUR_TBG_ENABLED !== "false",
    compactionTrigger: process.env.FOUR_TBG_COMPACTION_TRIGGER !== "false",
  };
}
