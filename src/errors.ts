/**
 * Custom error type for token-budget hard-limit cancellations.
 * UI/agents can detect via `err instanceof TokenBudgetExceededError`.
 */
export class TokenBudgetExceededError extends Error {
  readonly sessionID: string;
  readonly cumulative: number;
  readonly hardLimit: number;

  constructor(
    sessionID: string,
    cumulative: number,
    hardLimit: number,
    /** What was exceeded, so a policy block does not claim the hard limit. */
    reason = "HARD limit",
  ) {
    super(
      `Token budget ${reason} exceeded for session=${sessionID}: ${cumulative} > ${hardLimit}. Request canceled.`,
    );
    this.name = "TokenBudgetExceededError";
    this.sessionID = sessionID;
    this.cumulative = cumulative;
    this.hardLimit = hardLimit;
  }
}
