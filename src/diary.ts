import { mkdir, appendFile } from "node:fs/promises";

export interface DiaryEntry {
  ts: string;
  sessionID: string;
  msgRole: string;
  tokensApprox: number;
  cumulative: number;
  softLimit: number;
  hardLimit: number;
  /** Why the entry was written: ordinary turn, a limit hit, or policy enforce. */
  reason?: "turn" | "limit_exceeded" | "policy_enforce";
  /** Distinct metrics — present on entries written by the metrics-aware guard. */
  contextEstimate?: number;
  generatedEstimate?: number;
  cumulativeUsage?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

function todayFile(diaryDir: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${diaryDir}/${yyyy}-${mm}-${dd}.jsonl`;
}

export async function writeDiaryEntry(diaryDir: string, entry: DiaryEntry): Promise<void> {
  await mkdir(diaryDir, { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  await appendFile(todayFile(diaryDir), line, "utf-8");
}
