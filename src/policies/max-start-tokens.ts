import type { Policy, PolicyContext, PolicyResult } from "../policy-engine.js";

export class MaxStartTokensPolicy implements Policy {
  name = "max_start_tokens";
  private limit: number;

  constructor() {
    this.limit = parseInt(process.env.FOUR_TBG_MAX_START_TOKENS || "25000", 10);
  }

  async check(ctx: PolicyContext): Promise<PolicyResult | null> {
    if (ctx.cumulative <= this.limit) return null;

    return {
      name: this.name,
      level: "warn",
      message: `Session tokens (${ctx.cumulative}) exceed start-token limit (${this.limit})`,
      tokens: ctx.cumulative,
      limit: this.limit,
    };
  }
}
