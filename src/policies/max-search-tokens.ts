import type { Policy, PolicyContext, PolicyResult } from "../policy-engine.js";

export class MaxSearchResultTokensPolicy implements Policy {
  name = "max_search_result_tokens";

  async check(ctx: PolicyContext): Promise<PolicyResult | null> {
    const msg = ctx.message as any;
    if (!msg?.parts) return null;

    let totalLines = 0;
    for (const p of msg.parts) {
      if (typeof p?.text === "string") {
        totalLines += p.text.split("\n").length;
      }
    }

    if (totalLines <= 50) return null;

    return {
      name: this.name,
      level: totalLines > 200 ? "enforce" : "warn",
      message: `Message with ${totalLines} lines detected (search output?) — high token cost`,
      tokens: Math.ceil(totalLines * 6), // avg 6 chars/line
    };
  }
}
