import type { Policy, PolicyContext, PolicyResult } from "../policy-engine.js";

export class MaxPlannerTokensPolicy implements Policy {
  name = "max_planner_tokens";
  private limit: number;

  constructor() {
    this.limit = parseInt(process.env.FOUR_TBG_MAX_PLANNER_TOKENS || "3000", 10);
  }

  async check(ctx: PolicyContext): Promise<PolicyResult | null> {
    const msg = ctx.message as any;
    if (!msg?.info) return null;
    if (msg.info.role !== "assistant") return null;

    const parts = msg.parts || [];
    let totalText = "";
    for (const p of parts) {
      if (typeof p?.text === "string") totalText += p.text;
    }

    const tokens = Math.ceil(totalText.length / 4);
    if (tokens <= this.limit) return null;

    return {
      name: this.name,
      level: totalText.length > 2000 ? "enforce" : "warn",
      message: `Planner-like output (${tokens} tokens) exceeds limit (${this.limit})`,
      tokens,
      limit: this.limit,
    };
  }
}
