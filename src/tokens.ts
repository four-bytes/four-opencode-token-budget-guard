/**
 * Token estimator using chars/4 heuristic.
 * Cheap, no native deps. For v0.1.0 — replace with tiktoken in later sprint if accuracy matters.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
