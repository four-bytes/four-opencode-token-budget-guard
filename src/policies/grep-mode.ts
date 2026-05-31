import type { Policy, PolicyContext, PolicyResult } from "../policy-engine.js";

export class GrepModePolicy implements Policy {
  name = "grep_mode";

  async check(ctx: PolicyContext): Promise<PolicyResult | null> {
    const msg = ctx.message as any;
    if (!msg?.parts) return null;

    const enforce = process.env.FOUR_TBG_GREP_MODE === "enforce";
    let text = "";
    for (const p of msg.parts) {
      if (typeof p?.text === "string") text += p.text;
    }

    // Detect grep without --include flag
    const grepWithoutInclude = /\bgrep\b(?!.*--include)/i.test(text);

    if (!grepWithoutInclude) return null;

    // Count lines (estimate: grep output in message context)
    const lines = text.split("\n").length;
    if (lines <= 10) return null;

    return {
      name: this.name,
      level: enforce ? "enforce" : "warn",
      message: `grep detected without --include flag — consider rag_search as primary search tool (PAT-003 Reader-First)`,
      tokens: lines,
    };
  }
}
